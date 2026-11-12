export type DomainConnection = {
  domain: string;
  generation: string;
  status: "preparing" | "dns_required" | "certificate_pending" | "connecting" | "connected" | "retrying";
  address: string;
  dns?: { address: boolean; authorization: boolean };
  authorization?: { name: string; type: "CNAME"; data: string };
  updatedAt: string;
};
