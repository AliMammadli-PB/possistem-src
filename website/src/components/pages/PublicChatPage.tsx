'use client';

import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { PublicChatRoom } from '@/components/marketing/PublicChatRoom';

export function PublicChatPage() {
  return (
      <MarketingLayout solidHeader currentNav="support" hideFooter hideWhatsApp>
      <PublicChatRoom />
    </MarketingLayout>
  );
}
