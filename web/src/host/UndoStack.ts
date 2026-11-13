/** List of board versions. One board action = one version. */
export class UndoStack {
  private versions: string[];
  private index = 0;

  constructor(
    initial: string,
    private readonly max = 200,
  ) {
    this.versions = [initial];
  }

  get current(): string {
    return this.versions[this.index];
  }

  /** New board version. Drops the redo part. Ignores a text equal to current. Drops the oldest above max. */
  push(text: string): void {
    if (text === this.current) return;
    this.versions = this.versions.slice(0, this.index + 1);
    this.versions.push(text);
    // `max` undo steps = `max` + 1 versions.
    if (this.versions.length > this.max + 1) this.versions.splice(0, this.versions.length - this.max - 1);
    this.index = this.versions.length - 1;
  }

  /** undefined = nothing to undo. */
  undo(): string | undefined {
    if (this.index === 0) return undefined;
    this.index--;
    return this.current;
  }

  /** undefined = nothing to redo. */
  redo(): string | undefined {
    if (this.index === this.versions.length - 1) return undefined;
    this.index++;
    return this.current;
  }

  /** After Reload: history starts fresh. */
  reset(text: string): void {
    this.versions = [text];
    this.index = 0;
  }
}
