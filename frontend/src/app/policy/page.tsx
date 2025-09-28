import LegalDocumentPage from '../_components/legal-document-page';

export default function PolicyPage() {
  return (
    <LegalDocumentPage
      documentType="privacy"
      defaultTitle="سياسة الخصوصية"
      loadingLabel="جاري تحميل سياسة الخصوصية..."
      emptyMessageHtml="<p>لم يتم إعداد سياسة الخصوصية بعد. يرجى التواصل مع المسؤول.</p>"
    />
  );
}
