"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAssociatedTokenAddress = getAssociatedTokenAddress;
exports.createAssociatedTokenAccount = createAssociatedTokenAccount;
exports.getTokenAccount = getTokenAccount;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
// دالة بديلة لإنشاء عنوان الحساب المرتبط (ATA)
async function getAssociatedTokenAddress(mint, owner) {
    return (await web3_js_1.PublicKey.findProgramAddress([owner.toBuffer(), spl_token_1.TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID))[0];
}
// دالة بديلة لإنشاء حساب ATA إذا لم يكن موجوداً
async function createAssociatedTokenAccount(connection, payer, mint, owner) {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const accountInfo = await connection.getAccountInfo(ata);
    if (accountInfo)
        return ata;
    const tx = new web3_js_1.Transaction().add({
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: ata, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: spl_token_1.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        programId: spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID,
        data: Buffer.alloc(0),
    });
    await connection.sendTransaction(tx, [payer]);
    return ata;
}
// دالة بديلة لجلب بيانات الحساب المرتبط
async function getTokenAccount(connection, ata) {
    const info = await connection.getParsedAccountInfo(ata);
    if (!info.value)
        throw new Error('Token account not found');
    // @ts-ignore
    return info.value.data.parsed.info.tokenAmount;
}
