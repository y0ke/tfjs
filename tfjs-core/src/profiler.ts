/**
 * @license
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import {BackendTimer} from './backends/backend';
import {Tensor} from './tensor';
import {NamedTensorMap} from './tensor_types';
import {DataType, DataTypeMap, TypedArray} from './types';
import * as util from './util';

export class Profiler {
  constructor(private backendTimer: BackendTimer, private logger?: Logger) {
    if (logger == null) {
      this.logger = new Logger();
    }
  }

  profileKernel<T extends Tensor|Tensor[]>(
      name: string, inputs: NamedTensorMap, f: () => T | Tensor[]): T {
    let result: T|Tensor[];
    const holdResultWrapperFn = () => {
      result = f();
    };
    const timer = this.backendTimer.time(holdResultWrapperFn);

    const results: Tensor[] =
        Array.isArray(result) ? result : [result] as Tensor[];
    results.forEach(r => {
      // Dangling promise here because we don't want to propagate up
      // asynchronicity.
      r.data().then(vals => {
        checkComputationForErrors(vals, r.dtype, name);

        timer.then(timing => {
          let extraInfo = '';
          if (timing.getExtraProfileInfo != null) {
            extraInfo = timing.getExtraProfileInfo();
          }

          this.logger.logKernelProfile(
              name, r, vals, timing.kernelMs, inputs, extraInfo);
        });
      });
    });

    return result as T;
  }
}

// Create a custom exception class so it can be stubbed in tests.
export function ProfilerException(msg: string) {
  console.error(msg);
}

export function checkComputationForErrors<D extends DataType>(
    vals: DataTypeMap[D], dtype: D, name: string): void {
  if (dtype !== 'float32') {
    // Only floating point computations will generate NaN values
    return;
  }
  for (let i = 0; i < vals.length; i++) {
    const num = vals[i] as number;
    if (isNaN(num) || !isFinite(num)) {
      // Throwing custom exception so behavior is testable.
      throw ProfilerException(`The result of the '${name}' is ${num}.`);
    }
  }
}

export class Logger {
  logKernelProfile(
      name: string, result: Tensor, vals: TypedArray, timeMs: number,
      inputs: NamedTensorMap, extraInfo?: string) {
    const time = util.rightPad(`${timeMs}ms`, 9);
    const paddedName = util.rightPad(name, 25);
    const rank = result.rank;
    const size = result.size;
    const shape = util.rightPad(result.shape.toString(), 14);
    let inputShapesDescription = '';

    for (const name in inputs) {
      const inputShape = inputs[name].shape;
      const inputRank = inputShape.length;
      inputShapesDescription +=
          `${name}: ${inputRank}D ${inputRank > 0 ? inputShape : ''} `;
    }

    console.log(
        `%c${paddedName}\t%c${time}\t%c${rank}D ${shape}\t%c${size}\t%c${
            inputShapesDescription}\t%c${extraInfo}`,
        'font-weight:bold', 'color:red', 'color:blue', 'color: orange',
        'color: green', 'color: steelblue');
  }
}
