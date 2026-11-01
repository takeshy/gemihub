import React from "react";
import { ShopChat } from "./ShopChat";
import type { ChatReference } from "../server/shop-chat";
import type { RequestIntent } from "../server/request-intent";
import type { ShopConfig } from "../server/domain";
import type { Plan } from "./App";
export type ShopRequestProps = { initialIntent?: RequestIntent; shopId: string; published: boolean; isOwner: boolean; context?: { revision: number; hash: string }; currentConfig?: ShopConfig; plan?: Plan; onPlan: (text: string, imageIds?: string[], intent?: RequestIntent, chat?: ChatReference) => Promise<Plan>; onAccept: (plan: Plan) => Promise<void> };
export function ShopRequest(props: ShopRequestProps) { return <ShopChat {...props}/>; }
