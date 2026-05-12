import { Command } from "commander";

export async function run(argv: readonly string[] = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("maester")
    .description("Aggregate documentation from many sources into one citadel.")
    .version("0.1.0");

  await program.parseAsync(argv as string[]);
}
