import { customAlphabet } from "nanoid";

// Prefixed, alphabetic-start ids keep object-key order stable (integer-like
// keys would be reordered by JS engines) and make files easier to read.
const random = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

export const newNodeId = () => `n_${random()}`;
export const newImageId = () => `i_${random()}`;
export const newAssetId = () => `a_${random()}`;
