import FsStatementFace from "@/components/reports/FsStatementFace";

export default function StatementOfComprehensiveIncome() {
  return (
    <FsStatementFace
      statementCode="SOCI"
      fallbackTitle="Statement Of Comprehensive Income"
      subtitle="Profit or Loss and Other Comprehensive Income"
    />
  );
}
