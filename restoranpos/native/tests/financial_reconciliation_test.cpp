#include "catch_amalgamated.hpp"
#include "ServiceFixture.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/services/RefundService.hpp"
#include "pos/printing/ReceiptBuilder.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/services/CashService.hpp"
#include "pos/services/ReportService.hpp"

namespace {
void seedMoney(ServiceFixture& f) {
    f.openTill();
    const auto terminal=f.ctx().saleTerminalId();
    f.db().exec("INSERT INTO cash_accounts(id,name,kind,created_at) VALUES('audit-bank','Bank','bank',0)");
    for(const auto& id:{"cash","mixed","back"}) {
        const auto amount=std::string(id)=="cash"?2000:std::string(id)=="mixed"?1500:1000;
        auto o=f.db().prepare("INSERT INTO orders(id,order_number,status,guest_count,total_minor,paid_minor,user_id,opened_at,updated_at,business_day_id) VALUES(:id,:id,'closed',1,:n,:n,'usr-admin',100,100,(SELECT id FROM business_days WHERE status='open'))");
        o.bind(":id",std::string(id)).bind(":n",amount).exec();
        auto p=f.db().prepare("INSERT INTO payments(id,order_id,method,status,amount_minor,tip_minor,user_id,created_at,updated_at,terminal_id,business_day_id) VALUES(:id,:id,:method,:status,:n,0,'usr-admin',100,100,:terminal,(SELECT id FROM business_days WHERE status='open'))");
        p.bind(":id",std::string(id)).bind(":method",std::string(id)=="mixed"?std::string("mixed"):std::string("cash")).bind(":status",std::string(id)=="back"?std::string("refunded"):std::string("approved")).bind(":n",amount).bind(":terminal",terminal).exec();
    }
    f.db().exec("INSERT INTO payment_tenders(id,payment_id,method,amount_minor,tip_minor) VALUES('tc','mixed','cash',500,0),('tb','mixed','card',1000,0)");
    auto r=f.db().prepare("INSERT INTO refunds(id,order_id,payment_id,amount_minor,reason,status,method,created_at,updated_at,terminal_id,business_day_id) VALUES('refund','back','back',1000,'QA','completed','cash',200,200,:terminal,(SELECT id FROM business_days WHERE status='open'))");
    r.bind(":terminal",terminal).exec();
}
pos::Json call(ServiceFixture& f,const std::string& method,pos::Json payload,const std::string& key) {
    pos::ipc::Request r;r.requestId=pos::crypto::uuid4();r.method=method;r.payload=std::move(payload);r.idempotencyKey=key;return f.server().callHandler(r);
}
}
TEST_CASE("full refunds and mixed tenders reconcile cash accounts X Z and periods", "[audit_day][report][cash]") {
    ServiceFixture f;seedMoney(f);
    const auto day=pos::services::BusinessDayService(f.ctx()).openBusinessDayId().value();
    pos::services::CashService cash(f.ctx());pos::services::ReportService reports(f.ctx());
    CHECK(cash.accountBalance("test-till")==2500);
    CHECK(cash.accountBalance("audit-bank")==1000);
    CHECK(cash.expectedCash(day)==2500);
    const auto x=reports.buildCanonicalSnapshot(day,"x");
    CHECK(x["sales"]["grossMinor"]==4500);
    CHECK(x["sales"]["refundMinor"]==1000);
    CHECK(x["sales"]["netMinor"]==3500);
    CHECK(x["expectedCashMinor"]==2500);
    CHECK(x["cashDrawer"]["cashSalesMinor"]==3500);
    bool cashRow=false,cardRow=false;
    for(const auto& row:x["sales"]["byMethod"]){if(row["method"]=="cash"){CHECK(row["totalMinor"]==3500);cashRow=true;}if(row["method"]=="card"){CHECK(row["totalMinor"]==1000);cardRow=true;}CHECK(row["method"]!="mixed");}
    CHECK(cashRow);CHECK(cardRow);
    const auto period=reports.periodSummary(0,300);
    CHECK(period["sales"]["grossMinor"]==4500);CHECK(period["sales"]["netMinor"]==3500);CHECK(period["cashDrawer"]["expectedCashMinor"]==2500);
    const auto buckets=reports.periodBuckets(0,300,"hour");REQUIRE(buckets.size()==1);CHECK(buckets[0]["cashMinor"]==3500);CHECK(buckets[0]["cardMinor"]==1000);CHECK(buckets[0]["paymentCount"]==3);
    // A refund in a later window must not remove the original receipt from an older period.
    CHECK(reports.periodSummary(0,150)["sales"]["netMinor"]==4500);
    CHECK(reports.periodSummary(151,300)["sales"]["netMinor"]==-1000);
}
TEST_CASE("Z retry after a new day opens never closes the new day or prints twice", "[audit_day][idempotency]") {
    ServiceFixture f;f.openTill();pos::handlers::registerSystem(f.contextPtr());
    const auto first=pos::services::BusinessDayService(f.ctx()).openBusinessDayId().value();
    const auto key=pos::crypto::uuid4();const auto closed=call(f,"reports.z",pos::Json::object(),key);
    const auto next=call(f,"businessDay.open",{{"openingFloatMinor",0}},pos::crypto::uuid4())["businessDay"]["id"].get<std::string>();
    const auto again=call(f,"reports.z",pos::Json::object(),key);
    auto replayBody=again;replayBody.erase("idempotentReplay");CHECK(replayBody==closed);CHECK(pos::services::BusinessDayService(f.ctx()).openBusinessDayId().value_or("")==next);
    auto z=f.db().prepare("SELECT count(*) FROM report_snapshots WHERE kind='z'");REQUIRE(z.step());CHECK(z.columnInt(0)==1);
}
TEST_CASE("X and opening retries preserve one snapshot and business day", "[audit_day][idempotency]") {
    ServiceFixture f;f.openTill();pos::handlers::registerSystem(f.contextPtr());
    const auto key=pos::crypto::uuid4(),x=pos::crypto::uuid4();
    const auto a=call(f,"reports.x",pos::Json::object(),x),b=call(f,"reports.x",pos::Json::object(),x);auto replayX=b;replayX.erase("idempotentReplay");CHECK(a==replayX);
    call(f,"reports.z",pos::Json::object(),pos::crypto::uuid4());
    const auto opened=call(f,"businessDay.open",{{"openingFloatMinor",0}},key);
    auto replayOpen=call(f,"businessDay.open",{{"openingFloatMinor",0}},key);replayOpen.erase("idempotentReplay");CHECK(replayOpen==opened);
}

TEST_CASE("cash tips and cancelled expenses reconcile the snapshot and drawer", "[audit_day][cash]") {
    ServiceFixture f;seedMoney(f);
    const auto day=pos::services::BusinessDayService(f.ctx()).openBusinessDayId().value();
    f.db().exec("UPDATE payment_tenders SET tip_minor=20 WHERE id='tc'");
    auto move=f.db().prepare("INSERT INTO cash_movements(id,business_day_id,kind,amount_minor,reason,created_at,deleted_at) VALUES('cancelled',:day,'expense',700,'QA cancelled',100,200)");
    move.bind(":day",day).exec();
    pos::services::ReportService report(f.ctx());
    CHECK(pos::services::CashService(f.ctx()).expectedCash(day)==2520);
    CHECK(report.buildCanonicalSnapshot(day,"x")["expectedCashMinor"]==2520);
    CHECK(report.periodSummary(0,300)["cashDrawer"]["expectedCashMinor"]==2520);
}

TEST_CASE("unsupported mixed refunds fail before either ledger can change", "[audit_day][refund]") {
    ServiceFixture f;seedMoney(f);pos::services::CashService cash(f.ctx());
    const auto till=cash.accountBalance("test-till"),bank=cash.accountBalance("audit-bank");
    REQUIRE_THROWS_AS(pos::services::RefundService(f.ctx()).createRefund("mixed",500,"QA", "usr-admin",pos::crypto::uuid4(),{}),pos::PosError);
    CHECK(cash.accountBalance("test-till")==till);CHECK(cash.accountBalance("audit-bank")==bank);
    auto count=f.db().prepare("SELECT count(*) FROM refunds WHERE payment_id='mixed'");REQUIRE(count.step());CHECK(count.columnInt(0)==0);
}

TEST_CASE("shift paper shows mixed tenders full receipts and reconciled cash", "[audit_day][printing]") {
    ServiceFixture f;seedMoney(f);
    auto shift=f.db().prepare("INSERT INTO shifts(id,user_id,terminal_id,status,opening_float_minor,closing_cash_minor,expected_cash_minor,variance_minor,opened_at,closed_at) VALUES('audit-shift','usr-admin',:terminal,'closed',0,2500,2500,0,0,300)");
    shift.bind(":terminal",f.ctx().saleTerminalId()).exec();
    f.db().exec("UPDATE payments SET shift_id='audit-shift'; INSERT INTO cash_movements(id,shift_id,kind,amount_minor,reason,created_at) VALUES('cash-refund','audit-shift','cash_out',1000,'refund',200)");
    const auto paper=pos::printing::ReceiptBuilder(f.ctx()).shiftReport("audit-shift");
    CHECK(paper.data["cashMinor"]==3500);CHECK(paper.data["cardMinor"]==1000);CHECK(paper.data["transactionCount"]==3);CHECK(paper.data["cashRefundMinor"]==1000);CHECK(paper.data["expectedCashMinor"]==2500);
    CHECK(paper.text.find("Gözlənilən nağd")!=std::string::npos);
}
