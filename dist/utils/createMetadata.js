"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTokenMetadata = createTokenMetadata;
const web3_js_1 = require("@solana/web3.js");
const mpl_token_metadata_1 = require("@metaplex-foundation/mpl-token-metadata");
async function createTokenMetadata({ connection, mint, payer, name, symbol, uri }) {
    // حساب metadata PDA
    const metadataPDA = await mpl_token_metadata_1.Metadata.getPDA(mint);
    // تعليمات إنشاء metadata
    const instruction = (0, mpl_token_metadata_1.createCreateMetadataAccountV3Instruction)({
        metadata: metadataPDA,
        mint,
        mintAuthority: payer.publicKey,
        payer: payer.publicKey,
        updateAuthority: payer.publicKey,
    }, {
        createMetadataAccountArgsV3: {
            data: {
                name,
                symbol,
                uri, // رابط JSON metadata (يفضل رفعه على arweave أو ipfs)
                sellerFeeBasisPoints: 0,
                creators: null,
                collection: null,
                uses: null
            },
            isMutable: true,
            collectionDetails: null
        }
    });
    const tx = new web3_js_1.Transaction().add(instruction);
    const txid = await connection.sendTransaction(tx, [payer], { skipPreflight: false });
    return txid;
}
