// Run only inside the production container as an authorized operator.
// The printed URL grants owner access: share it privately with the intended judge.
import { randomBytes } from 'node:crypto';
import { Store } from '../server/store.ts';
import { digest, origin } from '../server/auth.ts';
import { judgeActive, judgeUntil } from '../server/judge.ts';

const shopId = process.argv.find(arg => arg.startsWith('--shop='))?.slice(7);
if (!shopId) throw new Error('Usage: node --import tsx scripts/issue-judge-recovery.mjs --shop=SHOP_ID');
const store = new Store();
try {
  const shop = await store.shop(shopId);
  const owner = shop && await store.get('user', shop.owner);
  if (!judgeActive() || !shop?.judge || !owner?.judge || owner.role !== 'owner' || owner.shopId !== shop.id || owner.email !== shop.owner)
    throw new Error('An active judge shop and its current owner are required');
  const token = randomBytes(32).toString('base64url');
  const expires = Math.min(Date.now() + 3600000, judgeUntil().getTime());
  await store.put('ticket', digest(token), {user: owner, host: new URL(origin()).hostname, slug: shop.slug, expires});
  console.log(JSON.stringify({shopId: shop.id, shopName: shop.published?.name, expires: new Date(expires).toISOString(), url: `${origin()}/auth/complete?ticket=${token}`}));
} finally {
  await store.close();
}
