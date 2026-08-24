import FsStatementFace from "@/components/reports/FsStatementFace";

export default function CashFlowStatement() {
  return (
    <FsStatementFace
      statementCode="CF"
      fallbackTitle="Statement Of Cash Flows"
      subtitle="Cash Flows From Operating, Investing and Financing Activities"
    />
  );
}
