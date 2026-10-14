import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  dir = path.join(os.homedir(), ".claude"),
  file = path.join(dir, "settings.json");
let original = "{}",
  settings;
try {
  original = await fs.readFile(file, "utf8");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
try {
  settings = JSON.parse(original);
} catch {
  throw new Error("Claude 설정 JSON이 올바르지 않아 변경하지 않았어요.");
}
const script = path.join(root, "scripts/claude-statusline.mjs");
if (!settings.statusLine?.command?.includes(script)) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const backup = path.join(dir, `settings.before-manage-a-${Date.now()}.json`);
  await fs.writeFile(backup, original, { mode: 0o600, flag: "wx" });
  await fs.mkdir(path.join(root, ".local"), { recursive: true, mode: 0o700 });
  await fs.writeFile(
    path.join(root, ".local/claude-statusline-previous.json"),
    JSON.stringify(settings.statusLine || null),
    { mode: 0o600 },
  );
  const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
  settings.statusLine = {
    ...(settings.statusLine || {}),
    type: "command",
    command: `${quote(process.execPath)} ${quote(script)}`,
  };
  const temp = file + ".manage-a.tmp";
  await fs.writeFile(temp, JSON.stringify(settings, null, 2) + "\n", {
    mode: 0o600,
  });
  await fs.rename(temp, file);
  console.log(
    "Claude 공식 상태줄 수집기를 연결했어요. 기존 설정은 같은 폴더에 백업했습니다. 로그인된 Claude Code의 응답 이후 한도가 수신됩니다.",
  );
} else console.log("Claude 한도 수집기가 이미 연결되어 있어요.");
