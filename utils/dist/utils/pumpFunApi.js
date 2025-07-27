"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPumpFunTokens = fetchPumpFunTokens;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
async function fetchPumpFunTokens() {
    const url = 'https://pump.fun/';
    const res = await axios_1.default.get(url);
    const $ = cheerio.load(res.data);
    const tokens = [];
    // This selector and parsing logic may need adjustment if pump.fun changes their HTML structure
    $('.token-list .token-row').each((i, el) => {
        const symbol = $(el).find('.token-symbol').text().trim();
        const address = $(el).find('.token-address').text().trim();
        const volume = parseFloat($(el).find('.token-volume').text().replace(/[^\d.]/g, ''));
        const holders = parseInt($(el).find('.token-holders').text().replace(/[^\d]/g, ''));
        const ageText = $(el).find('.token-age').text().trim();
        let ageMinutes = 0;
        if (ageText.includes('m'))
            ageMinutes = parseInt(ageText);
        if (ageText.includes('h'))
            ageMinutes = parseInt(ageText) * 60;
        const marketCap = parseFloat($(el).find('.token-marketcap').text().replace(/[^\d.]/g, ''));
        tokens.push({ symbol, address, volume, holders, ageMinutes, marketCap });
    });
    return tokens;
}
