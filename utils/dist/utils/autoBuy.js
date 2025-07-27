"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoBuy = autoBuy;
exports.getBoughtAmount = getBoughtAmount;
const wallet_1 = require("../wallet");
const web3_js_1 = require("@solana/web3.js");
const sdk_1 = require("@orca-so/sdk");
const tokenUtils_1 = require("./tokenUtils");
const decimal_js_1 = __importDefault(require("decimal.js"));
// شراء تلقائي للتوكن عبر Orca
async function autoBuy(tokenMint, solAmount) {
    const connection = (0, wallet_1.getConnection)();
    const wallet = (0, wallet_1.loadKeypair)(JSON.parse(process.env.PRIVATE_KEY));
    const network = process.env.NETWORK === 'devnet' ? sdk_1.Network.DEVNET : sdk_1.Network.MAINNET;
    const orca = (0, sdk_1.getOrca)(connection, network);
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
        // محاولة إنشاء pool تلقائياً (ملاحظة: Orca SDK لا يدعم ذلك مباشرة)
        const orcaUiUrl = `https://www.orca.so/create-pool?baseMint=${tokenMint}&quoteMint=So11111111111111111111111111111111111111112`;
        console.error('🚫 لم يتم العثور على زوج تداول لهذا التوكن على Orca.');
        console.error('🔗 يمكنك إنشاء pool يدوياً عبر الرابط التالي:');
        console.error(orcaUiUrl);
        throw new Error('يجب إنشاء pool لهذا التوكن على Orca قبل التداول.');
    }
    const amount = new decimal_js_1.default((solAmount * 1e9).toString()); // SOL إلى lamports
    const slippage = new decimal_js_1.default(process.env.SLIPPAGE || '0.1');
    const swapPayload = await pool.swap(wallet, pool.getTokenB(), amount, slippage);
    const tx = await swapPayload.execute();
    return tx;
}
// جلب كمية التوكن المملوكة بعد الشراء
async function getBoughtAmount(tokenMint, owner) {
    const connection = (0, wallet_1.getConnection)();
    const token = new web3_js_1.PublicKey(tokenMint);
    const ownerPk = new web3_js_1.PublicKey(owner);
    const tokenAccountAddress = await (0, tokenUtils_1.getAssociatedTokenAddress)(token, ownerPk);
    const tokenAmount = await (0, tokenUtils_1.getTokenAccount)(connection, tokenAccountAddress);
    return Number(tokenAmount.amount);
}
