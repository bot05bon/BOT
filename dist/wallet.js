"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadKeypair = loadKeypair;
exports.getConnection = getConnection;
const web3_js_1 = require("@solana/web3.js");
// تحميل المفتاح من ملف البيئة
function loadKeypair(secret) {
    if (!secret || !Array.isArray(secret) || secret.length < 32) {
        throw new Error('مفتاح خاص غير صالح. تحقق من PRIVATE_KEY في ملف البيئة.');
    }
    return web3_js_1.Keypair.fromSecretKey(Uint8Array.from(secret));
}
// إنشاء اتصال بالشبكة (Mainnet أو Devnet)
function getConnection() {
    const network = process.env.NETWORK === 'devnet' ? 'devnet' : 'mainnet-beta';
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.RPC_URL || (0, web3_js_1.clusterApiUrl)(network);
    return new web3_js_1.Connection(rpcUrl, 'confirmed');
}
