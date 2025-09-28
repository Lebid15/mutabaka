export interface Conversation {
  id: string;
  title: string;
  subtitle: string;
  time: string;
  unreadCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  author: 'me' | 'them';
  text: string;
  time: string;
  status?: 'sent' | 'delivered' | 'read';
}

export const conversations: Conversation[] = [
  { id: 'c1', title: 'منى خليل', subtitle: 'أراك مساء الغد في الاجتماع، لا تتأخر 🙌', time: '09:24', unreadCount: 2 },
  { id: 'c2', title: 'فريق الحسابات', subtitle: 'تم اعتماد تحويل مبلغ الاشتراك.', time: '08:10', unreadCount: 0 },
  { id: 'c3', title: 'علي السالم', subtitle: 'أرسلت لك المستندات المطلوبة الآن.', time: 'أمس', unreadCount: 0 },
];

export const messages: Message[] = [
  { id: 'm1', conversationId: 'c1', author: 'them', text: 'مرحباً! هل ما زلنا على موعدنا غداً؟', time: '08:56', status: 'delivered' },
  { id: 'm2', conversationId: 'c1', author: 'me', text: 'أكيد، سأكون في المكتب قبل التاسعة.', time: '09:01', status: 'read' },
  { id: 'm3', conversationId: 'c1', author: 'them', text: 'رائع، سأحضر معي عرض التحديثات الأخيرة.', time: '09:18', status: 'read' },
  { id: 'm4', conversationId: 'c1', author: 'me', text: 'تمام، أراك هناك 🙌', time: '09:24', status: 'read' },
  { id: 'm5', conversationId: 'c2', author: 'them', text: 'تم تحويل الدفعة إلى حساب الشركة الرئيسي.', time: 'أمس', status: 'delivered' },
  { id: 'm6', conversationId: 'c2', author: 'me', text: 'ممتاز يعطيكم العافية، سأراجعها الآن.', time: 'أمس', status: 'sent' },
  { id: 'm7', conversationId: 'c3', author: 'them', text: 'أرسلت لك نسخة PDF على البريد.', time: 'أمس', status: 'delivered' },
];
