"""Read Claude Code's built-in /usage screen in an empty, pre-trusted folder.
No model prompt, tools, MCP, hooks, project files or raw terminal log are used.
Only recognized quota percentages and reset labels leave this process.
"""
import os, sys, select, signal, time, re, json, subprocess

binary, workspace = sys.argv[1:3]
os.makedirs(workspace, mode=0o700, exist_ok=True)
if os.listdir(workspace):
    print(json.dumps({'state':'setup_required','reason':'quota_workspace_not_empty'})); sys.exit(0)
args = [binary, '--ax-screen-reader', '--tools', '', '--no-chrome', '--permission-mode', 'manual',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', 'user',
        '--settings', '{"enabledPlugins":{"codex@openai-codex":false},"disableAllHooks":true}']
child = subprocess.Popen(['/usr/bin/script','-q','/dev/null']+args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=workspace, start_new_session=True)
pid, fd = child.pid, child.stdout.fileno()
rows = [[' '] * 180 for _ in range(300)]
y = x = 0
pending = ''
sent = False
started = last_change = time.monotonic()
result = None

def screen():
    return '\n'.join(''.join(row).rstrip() for row in rows)

def quotas(text):
    lines = text.splitlines()
    windows = []
    current = None
    for line in lines:
        label = line.strip()
        if label in ('Current session', 'Current week (all models)', 'Current week (Sonnet only)', 'Current week (Opus only)'):
            current = {'label':label}
        elif current and re.search(r'(\d+(?:\.\d+)?)%\s+used', line):
            value = float(re.findall(r'(\d+(?:\.\d+)?)%\s+used', line)[-1])
            if 0 <= value <= 100: current['usedPercent'] = value
        elif current and label.startswith('Resets ') and 'usedPercent' in current:
            current['resetLabel'] = label[:120]
            windows.append(current)
            current = None
    return windows

try:
    while time.monotonic() - started < 22:
        ready, _, _ = select.select([fd], [], [], .2)
        if ready:
            try: chunk = os.read(fd, 65536).decode('utf-8', errors='replace')
            except OSError: break
            if not chunk: break
            last_change = time.monotonic()
            pending += chunk
            i = 0
            while i < len(pending):
                c = pending[i]
                if c == '\x1b':
                    if i + 1 >= len(pending): break
                    if pending[i+1] == '[':
                        m = re.match(r'\x1b\[([0-9;?<>]*)([ -/]*)([@-~])', pending[i:])
                        if not m: break
                        value, _, op = m.groups()
                        numbers = [int(v or 0) for v in value.split(';')] if re.fullmatch('[0-9;]*', value) else [0]
                        n = numbers[0] or 1
                        if op == 'A': y = max(0,y-n)
                        elif op == 'B': y = min(299,y+n)
                        elif op == 'C': x = min(179,x+n)
                        elif op == 'D': x = max(0,x-n)
                        elif op == 'G': x = min(179,n-1)
                        elif op in ('H','f'):
                            y = min(299,n-1); x = min(179,(numbers[1] or 1)-1 if len(numbers)>1 else 0)
                        elif op == 'K':
                            mode = numbers[0]
                            a,b = (0,180) if mode==2 else (0,x+1) if mode==1 else (x,180)
                            rows[y][a:b] = [' '] * (b-a)
                        elif op == 'J' and numbers[0] == 2:
                            rows = [[' '] * 180 for _ in range(300)]
                        i += len(m.group()); continue
                    elif pending[i+1] == ']':
                        m = re.search(r'\x07|\x1b\\',pending[i+2:])
                        if not m: break
                        i += 2 + m.end(); continue
                    else: i += 2; continue
                if c == '\r': x = 0
                elif c == '\n': y = min(299,y+1)
                elif c == '\b': x = max(0,x-1)
                elif ord(c) >= 32:
                    rows[y][x] = c
                    x += 1
                    if x >= 180: x=0; y=min(299,y+1)
                i += 1
            pending = pending[i:]
        text = screen()
        if not sent and 'Claude Code v' in text and re.search(r'^\$\s*$',text,re.M):
            child.stdin.write(b'/usage\r'); child.stdin.flush(); sent=True
        values = quotas(text)
        if sent and values and 'Refreshing' not in text and time.monotonic()-last_change > 1.4:
            result = {'state':'connected','windows':values}; break
        if not sent and ('trust this folder' in text or 'Choose the text style' in text or 'Select login method' in text):
            result = {'state':'setup_required','reason':'interactive_setup_required'}; break
    if result is None:
        result = {'state':'unavailable','reason':'quota_screen_not_received'}
finally:
    try: os.killpg(pid,signal.SIGTERM)
    except ProcessLookupError: pass
    for _ in range(10):
        try:
            done, _status = os.waitpid(pid, os.WNOHANG)
            if done: break
        except ChildProcessError: break
        time.sleep(.05)
    else:
        try: os.killpg(pid,signal.SIGKILL)
        except ProcessLookupError: pass
        try: os.waitpid(pid,0)
        except ChildProcessError: pass
    child.stdin.close(); child.stdout.close()
print(json.dumps(result))
