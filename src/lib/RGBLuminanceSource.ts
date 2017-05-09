/*
 * Copyright 2009 ZXing authors
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

/*namespace com.google.zxing {*/

import LuminanceSource from './LuminanceSource'
import Exception from './Exception'
import System from './util/System'

/**
 * This class is used to help decode images from files which arrive as RGB data from
 * an ARGB pixel array. It does not support rotation.
 *
 * @author dswitkin@google.com (Daniel Switkin)
 * @author Betaminos
 */
export default class RGBLuminanceSource extends LuminanceSource {
  
  // public constructor(width: number/*int*/, height: number/*int*/, const pixels: Int32Array) {
  //   super(width, height)

  //   dataWidth = width
  //   dataHeight = height
  //   left = 0
  //   top = 0

  //   // In order to measure pure decoding speed, we convert the entire image to a greyscale array
  //   // up front, which is the same as the Y channel of the YUVLuminanceSource in the real app.
  //   //
  //   // Total number of pixels suffices, can ignore shape
  //   const size = width * height;
  //   luminances = new byte[size]
  //   for (let offset = 0; offset < size; offset++) {
  //     const pixel = pixels[offset]
  //     const r = (pixel >> 16) & 0xff; // red
  //     const g2 = (pixel >> 7) & 0x1fe; // 2 * green
  //     const b = pixel & 0xff; // blue
  //     // Calculate green-favouring average cheaply
  //     luminances[offset] = (byte) ((r + g2 + b) / 4)
  //   }
  // }
  
  public constructor(private luminances: Uint8Array,
                             private dataWidth: number/*int*/,
                             private dataHeight: number/*int*/,
                             private left: number/*int*/,
                             private top: number/*int*/,
                             width: number/*int*/,
                             height: number/*int*/) {
    super(width, height)
    if (left + width > dataWidth || top + height > dataHeight) {
      throw new Exception(Exception.IllegalArgumentException, "Crop rectangle does not fit within image data.")
    }
  }

  /*@Override*/
  public getRow(y: number/*int*/, row: Uint8Array): Uint8Array {
    if (y < 0 || y >= this.getHeight()) {
      throw new Exception(Exception.IllegalArgumentException, "Requested row is outside the image: " + y)
    }
    const width = this.getWidth()
    if (row === null || row.length < width) {
      row = new Uint8Array(width)
    }
    const offset = (y + this.top) * this.dataWidth + this.left
    System.arraycopy(this.luminances, offset, row, 0, width)
    return row
  }

  /*@Override*/
  public getMatrix(): Uint8Array {
    const width = this.getWidth();
    const height = this.getHeight();

    // If the caller asks for the entire underlying image, save the copy and give them the
    // original data. The docs specifically warn that result.length must be ignored.
    if (width === this.dataWidth && height === this.dataHeight) {
      return this.luminances
    }

    const area = width * height;
    const matrix = new Uint8Array(area)
    let inputOffset = this.top * this.dataWidth + this.left;

    // If the width matches the full width of the underlying data, perform a single copy.
    if (width === this.dataWidth) {
      System.arraycopy(this.luminances, inputOffset, matrix, 0, area)
      return matrix
    }

    // Otherwise copy one cropped row at a time.
    for (let y = 0; y < height; y++) {
      const outputOffset = y * width;
      System.arraycopy(this.luminances, inputOffset, matrix, outputOffset, width)
      inputOffset += this.dataWidth
    }
    return matrix
  }
  
  /*@Override*/
  public isCropSupported(): boolean {
    return true
  }

  /*@Override*/
  public crop(left: number/*int*/, top: number/*int*/, width: number/*int*/, height: number/*int*/): LuminanceSource {
    return new RGBLuminanceSource(this.luminances,
                                  this.dataWidth,
                                  this.dataHeight,
                                  this.left + left,
                                  this.top + top,
                                  width,
                                  height)
  }

}