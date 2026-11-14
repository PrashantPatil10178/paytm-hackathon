import tailwind from "bun-plugin-tailwind";

// Static production bundle (the dev/start servers bundle on the fly via bunfig.toml).
const result = await Bun.build({
  entrypoints: ["./src/index.html"],
  outdir: "./dist",
  minify: true,
  sourcemap: "linked",
  plugins: [tailwind],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`Built ${result.outputs.length} files into dist/`);
