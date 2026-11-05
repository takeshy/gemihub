// Read-only replay with the deployed provider/credentials. Does not create sessions, charge/refund,
// update the ledger or consume judge usage records. Run inside the configured app environment:
// node --import tsx scripts/diagnose-paypal-consult.mjs --shop=ID [--question="..."]
import { Store } from '../server/store.ts';
import { paypalGateway } from '../server/paypal.ts';
import { paypalOps } from '../server/paypal-ops.ts';
import { converse } from '../server/assistant.ts';
import { setProviderResolver } from '../server/llm.ts';
import { documents } from '../server/domain.ts';
import { requestLocale } from '../server/i18n.ts';
import { dateIn, regionOf } from '../shared/region.ts';

const args = process.argv.slice(1);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const shopId = option('shop');
if (!shopId) throw new Error('--shop=ID is required; no other shops are inspected');
const question = option('question') || 'Did the latest refund go through on PayPal?';
const locale = option('lang') === 'ja' ? 'ja' : 'en';
const store = new Store();
try {
  const shop = await store.shop(shopId);
  if (!shop?.published) throw new Error('Published shop not found');
  const provider = (await store.get('setting', 'aiProvider'))?.provider || 'vertex';
  setProviderResolver(async () => provider);
  const readOnly = async () => { throw new Error('Read-only diagnosis: mutation refused'); };
  const ops = paypalOps({ store, gateway: paypalGateway(), reconcile: readOnly, closeTransfer: readOnly, sync: readOnly, recordHistory: readOnly, appOrigin: () => process.env.APP_ORIGIN });
  const tools = await ops.toolsFor(shop);
  console.log(JSON.stringify({ event: 'paypal_consult_replay', shopId, provider, judge: !!shop.judge, tools: tools?.tools.map(tool => tool.name) }));
  const started = Date.now();
  const result = await requestLocale.run(locale, () => converse({ question, messages: [], data: {
    documents: documents(shop.published, shop.history),
    today: dateIn(new Date(), regionOf(shop.published).timeZone),
    paypal: tools,
    records: async kind => {
      if (kind !== 'bookings') return [];
      return (await store.bookings(shop.id)).map(b => ({ id: b.id, start: b.start, status: b.status, customer: b.name, price: b.price,
        ...(b.payment ? { payment: { amount: b.payment.amount, currency: b.payment.currency, refund: b.payment.cancellation ? { id: b.payment.cancellation.refundId, amount: b.payment.cancellation.amount, status: b.payment.cancellation.status } : undefined } } : {}),
      }));
    },
  } }));
  console.log(JSON.stringify({ event: 'paypal_consult_result', elapsedMs: Date.now() - started, ...result }));
} finally { await store.close(); }
