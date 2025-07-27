"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sellWithOrca = sellWithOrca;
const wallet_1 = require("./wallet");
const sdk_1 = require("@orca-so/sdk");
const tokenUtils_1 = require("./utils/tokenUtils");
const decimal_js_1 = __importDefault(require("decimal.js"));
async function sellWithOrca(tokenMint, amountIn) {
    const connection = (0, wallet_1.getConnection)();
    if (!process.env.PRIVATE_KEY)
        throw new Error('PRIVATE_KEY غير معرف في ملف البيئة');
    const wallet = (0, wallet_1.loadKeypair)(JSON.parse(process.env.PRIVATE_KEY));
    const network = process.env.NETWORK === 'devnet' ? sdk_1.Network.DEVNET : sdk_1.Network.MAINNET;
    const orca = (0, sdk_1.getOrca)(connection, network);
    const userPublicKey = wallet.publicKey;
    // اكتشاف الـ pool المناسب تلقائياً (SOL/tokenMint)
    let pool = null;
    let foundConfig = null;
    for (const [key, value] of Object.entries(sdk_1.OrcaPoolConfig)) {
        try {
            const p = orca.getPool(value);
            const tokenAMint = p.getTokenA().mint.toBase58();
            const tokenBMint = p.getTokenB().mint.toBase58();
            if ((tokenAMint === tokenMint || tokenBMint === tokenMint) &&
                (tokenAMint === 'So11111111111111111111111111111111111111112' || tokenBMint === 'So11111111111111111111111111111111111111112')) {
                pool = p;
                foundConfig = value;
                break;
            }
        }
        catch (e) {
            continue;
        }
    }
    if (!pool) {
        const orcaUiUrl = `https://www.orca.so/create-pool?baseMint=${tokenMint}&quoteMint=So11111111111111111111111111111111111111112`;
        console.error('🚫 لم يتم العثور على زوج تداول لهذا التوكن على Orca.');
        console.error('🔗 يمكنك إنشاء pool يدوياً عبر الرابط التالي:');
        console.error(orcaUiUrl);
        throw new Error('يجب إنشاء pool لهذا التوكن على Orca قبل التداول.');
    }
    const tokenAccountAddress = await (0, tokenUtils_1.getAssociatedTokenAddress)(pool.getTokenA().mint, userPublicKey);
    const tokenAmount = await (0, tokenUtils_1.getTokenAccount)(connection, tokenAccountAddress);
    if (Number(tokenAmount.amount) < amountIn) {
        throw new Error(`🚫 الرصيد غير كافٍ للبيع. الرصيد الحالي: ${Number(tokenAmount.amount)}`);
    }
    const amount = new decimal_js_1.default(amountIn.toString());
    const slippage = new decimal_js_1.default(process.env.SLIPPAGE || '0.1');
    try {
        const swapPayload = await pool.swap(wallet, pool.getTokenA(), amount, slippage);
        const tx = await swapPayload.execute();
        console.log(`✅ بيع التوكن! المعاملة: https://solscan.io/tx/${tx}`);
    }
    catch (err) {
        console.error('❌ فشل تنفيذ swap:', err);
        throw err;
    }
}
