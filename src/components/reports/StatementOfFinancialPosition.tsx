import FsStatementFace from "@/components/reports/FsStatementFace";

export default function StatementOfFinancialPosition() {
  return (
    <FsStatementFace
      statementCode="SFP"
      fallbackTitle="Statement Of Financial Position"
      subtitle="Assets, Liabilities and Equity"
      pointInTime
    />
  );
}
