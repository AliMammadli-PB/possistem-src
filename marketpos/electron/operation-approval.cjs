'use strict';
const {verifyManagerPin}=require('./staff-auth.cjs');

/** Verify the person who approves one operation. Only an active manager or
 * the signed superadmin record can approve; actor permissions are checked
 * separately by main/core. No renderer-supplied identity is trusted. */
async function approveOperation({pin,staff,superAdmin,superIdentity,verifySuperPin,limiter,superOnly=false,record}) {
  const required=superOnly?'E_SUPERADMIN_REQUIRED':'E_MANAGER_REQUIRED';
  const failure=message=>({success:false,error:{code:required,message,retryable:false}});
  if(!pin)return failure('Bu əməliyyat üçün müdir kodunu daxil edin');
  limiter.assertOpen('operation-approval');
  let approver=null;
  if(/^\d{10}$/.test(pin)&&verifySuperPin(superAdmin,pin))approver={id:superIdentity.id,role:superIdentity.role};
  else if(!superOnly&&/^\d{4,8}$/.test(pin)) {
    const result=verifyManagerPin((staff||[]).filter(user=>user.role==='manager'),pin,null);
    if(result.ok)approver={id:result.approverId,role:result.role};
  }
  if(!approver){limiter.fail('operation-approval');return failure('Müdir kodu yanlışdır və ya hesab aktiv deyil');}
  limiter.succeed('operation-approval');
  const audit=await record(approver);
  if(!audit?.success)return {success:false,error:{code:'E_APPROVAL_AUDIT',message:'Təsdiq tarixçəyə yazılmadı. Yenidən sınayın.',retryable:true}};
  return {success:true,approver};
}
module.exports={approveOperation};
