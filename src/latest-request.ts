export class LatestRequestGate {
  private generation = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  current(): number {
    return this.generation;
  }
}
