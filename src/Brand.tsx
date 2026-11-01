import React from "react";
import { serviceName } from "../shared/brand";

export function Brand({ href = "/" }: { href?: string }) {
  return <a href={href} className="brand"><span className="brand-icon">g<span>✳</span></span>{serviceName}<span className="brand-dot">.</span></a>;
}
