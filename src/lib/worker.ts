interface WorkerConstructorOptions {
  name?: string;
}
type WorkerConstructor = new (options?: WorkerConstructorOptions) => Worker;

export class WorkerManager<ParameterType, ResultType> {
  private _worker: Worker | null = null;

  constructor(
    private readonly workerConstructor: WorkerConstructor,
    private readonly options?: WorkerConstructorOptions,
  ) {}

  async invoke(parameter: ParameterType): Promise<ResultType> {
    if (this._worker == null) {
      this._worker = new this.workerConstructor(this.options);
    }

    return await new Promise<ResultType>((resolve, reject) => {
      if (this._worker == null) {
        reject('worker is not initialized');
        return; // actually, not reached
      }

      this._worker.onmessage = function (e: MessageEvent<ResultType>) {
        resolve(e.data);
      };
      this._worker.onmessageerror = function (e) {
        reject(e);
      };

      this._worker.postMessage(parameter);
    });
  }

  get worker() {
    return this._worker;
  }
}
