import LegalDocumentPage from '../_components/legal-document-page';

export default function TermsPage() {
  return (
    <LegalDocumentPage
      documentType="terms"
      defaultTitle="شروط الاستخدام"
      loadingLabel="جاري تحميل شروط الاستخدام..."
      emptyMessageHtml="<p>لم يتم إعداد شروط الاستخدام بعد. يرجى التواصل مع المسؤول.</p>"
    />
  );
}
