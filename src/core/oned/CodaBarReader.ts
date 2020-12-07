/*
 * Copyright 2008 ZXing authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*namespace com.google.zxing.oned {*/

import BarcodeFormat from '../BarcodeFormat';
import BitArray from '../common/BitArray';
import DecodeHintType from '../DecodeHintType';
import NotFoundException from '../NotFoundException';
import OneDReader from './OneDReader';
import Result from '../Result';
import ResultPoint from '../ResultPoint';

/**
 * <p>Decodes CodaBar barcodes. </p>
 *
 * @author Evan @dodobelieve
 * @see CodaBarReader
 */
export default class CodaBarReader extends OneDReader {
    // These values are critical for determining how permissive the decoding
    // will be. All stripe sizes must be within the window these define, as
    // compared to the average stripe size.
    private static readonly MAX_ACCEPTABLE = 2.0;
    private static readonly PADDING = 1.5;

    private static readonly ALPHABET_STRING = "0123456789-$:/.+ABCD";
    static readonly ALPHABET = CodaBarReader.ALPHABET_STRING.split('');

    /**
     * These represent the encodings of characters, as patterns of wide and narrow bars. The 7 least-significant bits of
     * each int correspond to the pattern of wide and narrow, with 1s representing "wide" and 0s representing narrow.
     */
    static readonly CHARACTER_ENCODINGS = [
        0x003, 0x006, 0x009, 0x060, 0x012, 0x042, 0x021, 0x024, 0x030, 0x048, // 0-9
        0x00c, 0x018, 0x045, 0x051, 0x054, 0x015, 0x01A, 0x029, 0x00B, 0x00E, // -$:/.+ABCD
    ];

    // minimal number of characters that should be present (including start and stop characters)
    // under normal circumstances this should be set to 3, but can be set higher
    // as a last-ditch attempt to reduce false positives.
    private static readonly MIN_CHARACTER_LENGTH = 3;

    // official start and end patterns
    private static readonly STARTEND_ENCODING = ['A', 'B', 'C', 'D'];

    private decodeRowResult;
    private counters;
    private counterLength;


    constructor() {
        super();
        this.decodeRowResult = [];
        this.counters = new Array();
        this.counterLength = 0;
    }


    public decodeRow(rowNumber: number, row: BitArray, hints?: Map<DecodeHintType, any>): Result {

        this.counters = new Array(80).fill(0)
        this.setCounters(row);
        let startOffset = this.findStartPattern();
        let nextStart = startOffset;

        this.decodeRowResult = [];
        do {
            let charOffset = this.toNarrowWidePattern(nextStart);
            if (charOffset == -1) {
                throw NotFoundException.getNotFoundInstance();
            }
            // Hack: We store the position in the alphabet table into a
            // StringBuilder, so that we can access the decoded patterns in
            // validatePattern. We'll translate to the actual characters later.
            this.decodeRowResult.push(charOffset);
            nextStart += 8;
            // Stop as soon as we see the end character.
            if (this.decodeRowResult.length > 1 &&
                CodaBarReader.arrayContains(CodaBarReader.STARTEND_ENCODING, CodaBarReader.ALPHABET[charOffset])) {
                break;
            }
        } while (nextStart < this.counterLength); // no fixed end pattern so keep on reading while data is available

        // Look for whitespace after pattern:
        let trailingWhitespace = this.counters[nextStart - 1];
        let lastPatternSize = 0;
        for (let i = -8; i < -1; i++) {
            lastPatternSize += this.counters[nextStart + i];
        }

        // We need to see whitespace equal to 50% of the last pattern size,
        // otherwise this is probably a false positive. The exception is if we are
        // at the end of the row. (I.e. the barcode barely fits.)
        if (nextStart < this.counterLength && trailingWhitespace < lastPatternSize / 2) {
            throw NotFoundException.getNotFoundInstance();
        }

        this.validatePattern(startOffset);

        // Translate character table offsets to actual characters.
        for (let i = 0; i < this.decodeRowResult.length; i++) {
            this.decodeRowResult[i] = CodaBarReader.ALPHABET[this.decodeRowResult[i]];
        }
        // Ensure a valid start and end character
        let startchar = this.decodeRowResult[0];
        if (!CodaBarReader.arrayContains(CodaBarReader.STARTEND_ENCODING, startchar)) {
            throw NotFoundException.getNotFoundInstance();
        }
        let endchar = this.decodeRowResult[this.decodeRowResult.length - 1];
        if (!CodaBarReader.arrayContains(CodaBarReader.STARTEND_ENCODING, endchar)) {
            throw NotFoundException.getNotFoundInstance();
        }

        // remove stop/start characters character and check if a long enough string is contained
        if (this.decodeRowResult.length <= CodaBarReader.MIN_CHARACTER_LENGTH) {
            // Almost surely a false positive ( start + stop + at least 1 character)
            throw NotFoundException.getNotFoundInstance();
        }
        if (hints == null || !hints.has(DecodeHintType.RETURN_CODABAR_START_END)) {
            this.decodeRowResult[this.decodeRowResult.length - 1] = "";
            this.decodeRowResult[0] = "";
        }

        let runningCount = 0;
        for (let i = 0; i < startOffset; i++) {
            runningCount += this.counters[i];
        }
        let left = runningCount;
        for (let i = startOffset; i < nextStart - 1; i++) {
            runningCount += this.counters[i];
        }
        let right = runningCount;

        const points: ResultPoint[] = [new ResultPoint(left, rowNumber), new ResultPoint(right, rowNumber)];
        return new Result(this.decodeRowResult.join(""), null, 0, points, BarcodeFormat.CODABAR, new Date().getTime());
    }


    private validatePattern(start: number) {
        // First, sum up the total size of our four categories of stripe sizes;
        let sizes = [0, 0, 0, 0];
        let counts = [0, 0, 0, 0];
        let end = this.decodeRowResult.length - 1;

        // We break out of this loop in the middle, in order to handle
        // inter-character spaces properly.
        let pos = start;
        for (let i = 0; true; i++) {
            let pattern = CodaBarReader.CHARACTER_ENCODINGS[this.decodeRowResult[i]];
            for (let j = 6; j >= 0; j--) {
                // Even j = bars, while odd j = spaces. Categories 2 and 3 are for
                // long stripes, while 0 and 1 are for short stripes.
                let category = (j & 1) + (pattern & 1) * 2;
                sizes[category] += this.counters[pos + j];
                counts[category]++;
                pattern >>= 1;
            }
            if (i >= end) {
                break;
            }
            // We ignore the inter-character space - it could be of any size.
            pos += 8;
        }

        // Calculate our allowable size thresholds using fixed-point math.
        let maxes = new Array(4);
        let mins = new Array(4);
        // Define the threshold of acceptability to be the midpoint between the
        // average small stripe and the average large stripe. No stripe lengths
        // should be on the "wrong" side of that line.
        for (let i = 0; i < 2; i++) {
            mins[i] = 0.0;  // Accept arbitrarily small "short" stripes.
            mins[i + 2] = (sizes[i] / counts[i] + sizes[i + 2] / counts[i + 2]) / 2.0;
            maxes[i] = mins[i + 2];
            maxes[i + 2] = (sizes[i + 2] * CodaBarReader.MAX_ACCEPTABLE + CodaBarReader.PADDING) / counts[i + 2];
        }

        // Now verify that all of the stripes are within the thresholds.
        pos = start;
        for (let i = 0; true; i++) {
            let pattern = CodaBarReader.CHARACTER_ENCODINGS[this.decodeRowResult[i]];
            for (let j = 6; j >= 0; j--) {
                // Even j = bars, while odd j = spaces. Categories 2 and 3 are for
                // long stripes, while 0 and 1 are for short stripes.
                let category = (j & 1) + (pattern & 1) * 2;
                let size = this.counters[pos + j];
                if (size < mins[category] || size > maxes[category]) {
                    throw NotFoundException.getNotFoundInstance();
                }
                pattern >>= 1;
            }
            if (i >= end) {
                break;
            }
            pos += 8;
        }
    }

    /**
   * Records the size of all runs of white and black pixels, starting with white.
   * This is just like recordPattern, except it records all the counters, and
   * uses our builtin "counters" member for storage.
   * @param row row to count from
   */
    private setCounters(row: BitArray) {
        this.counterLength = 0;
        // Start from the first white bit.
        let i = row.getNextUnset(0);
        let end = row.getSize();
        if (i >= end) {
            throw NotFoundException.getNotFoundInstance();
        }
        let isWhite = true;
        let count = 0;
        while (i < end) {
            if (row.get(i) != isWhite) {
                count++;
            } else {
                this.counterAppend(count);
                count = 1;
                isWhite = !isWhite;
            }
            i++;
        }
        this.counterAppend(count);
    }

    private counterAppend(e: number) {
        this.counters[this.counterLength] = e;
        this.counterLength++;
        if (this.counterLength >= this.counters.length) {
            let temp = this.counters.slice();
            this.counters = temp;
        }
    }

    private findStartPattern() {
        for (let i = 1; i < this.counterLength; i += 2) {
            let charOffset = this.toNarrowWidePattern(i);
            if (charOffset != -1 && CodaBarReader.arrayContains(CodaBarReader.STARTEND_ENCODING, CodaBarReader.ALPHABET[charOffset])) {
                // Look for whitespace before start pattern, >= 50% of width of start pattern
                // We make an exception if the whitespace is the first element.
                let patternSize = 0;
                for (let j = i; j < i + 7; j++) {
                    patternSize += this.counters[j];
                }
                if (i == 1 || this.counters[i - 1] >= patternSize / 2) {
                    return i;
                }
            }
        }
        throw NotFoundException.getNotFoundInstance();
    }

    static arrayContains(arr: Array<String>, key: String) {
        if (arr != null) {
            for (let c of arr) {
                if (c == key) {
                    return true;
                }
            }
        }
        return false;
    }

    // Assumes that counters[position] is a bar.
    private toNarrowWidePattern(position: number) {
        let end = position + 7;
        if (end >= this.counterLength) {
            return -1;
        }

        let theCounters = this.counters;

        let maxBar = 0;
        let minBar = Number.MAX_VALUE;
        for (let j = position; j < end; j += 2) {
            let currentCounter = theCounters[j];
            if (currentCounter < minBar) {
                minBar = currentCounter;
            }
            if (currentCounter > maxBar) {
                maxBar = currentCounter;
            }
        }
        let thresholdBar = (minBar + maxBar) / 2;

        let maxSpace = 0;
        let minSpace = Number.MAX_VALUE;
        for (let j = position + 1; j < end; j += 2) {
            let currentCounter = theCounters[j];
            if (currentCounter < minSpace) {
                minSpace = currentCounter;
            }
            if (currentCounter > maxSpace) {
                maxSpace = currentCounter;
            }
        }
        let thresholdSpace = (minSpace + maxSpace) / 2;

        let bitmask = 1 << 7;
        let pattern = 0;
        for (let i = 0; i < 7; i++) {
            let threshold = (i & 1) == 0 ? thresholdBar : thresholdSpace;
            bitmask >>= 1;
            if (theCounters[position + i] > threshold) {
                pattern |= bitmask;
            }
        }

        for (let i = 0; i < CodaBarReader.CHARACTER_ENCODINGS.length; i++) {
            if (CodaBarReader.CHARACTER_ENCODINGS[i] == pattern) {
                return i;
            }
        }
        return -1;
    }
}