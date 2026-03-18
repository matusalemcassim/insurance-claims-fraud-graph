import ClaimClient from "./ClaimClient";

type PageProps = {
  params: Promise<{ claimId: string }>;
};

export default async function Page({ params }: PageProps) {
  const { claimId } = await params;
  return <ClaimClient claimId={claimId} />;
}
