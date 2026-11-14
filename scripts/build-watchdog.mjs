// Builds shell-watchdog in release and places it where Tauri's bundler
// expects an external binary (`binaries/<name>-<target-triple>.exe`), so
// installers ship it next to Udaan.exe. Without it, "Make Udaan the
// Windows shell" correctly refuses to run.
//
// It is compiled into its OWN target folder, then copied. While Udaan is running, its guard process
// (`shell-watchdog.exe --guard`) holds `target/release/shell-watchdog.exe` open, and cargo cannot
// overwrite a running program, which used to make every rebuild fail while Udaan was open. Building
// elsewhere means the build always works, and the copy next to Udaan.exe is updated whenever it is
// not in use (and skipped, harmlessly, when it is: the guard's code rarely changes).
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri')
const triple = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/host: (\S+)/)[1]
const ext = process.platform === 'win32' ? '.exe' : ''
const targetDir = join(root, 'target', 'watchdog-build')

execFileSync('cargo', ['build', '--release', '-p', 'shell-watchdog', '--target-dir', targetDir], { cwd: root, stdio: 'inherit' })
const built = join(targetDir, 'release', `shell-watchdog${ext}`)

mkdirSync(join(root, 'binaries'), { recursive: true })
const out = join(root, 'binaries', `shell-watchdog-${triple}${ext}`)
copyFileSync(built, out)
console.log(`shell-watchdog -> ${out}`)

// Keep the copy that Udaan launches (next to Udaan.exe) current, unless a guard is running from it.
const beside = join(root, 'target', 'release', `shell-watchdog${ext}`)
try {
  mkdirSync(dirname(beside), { recursive: true })
  copyFileSync(built, beside)
  console.log(`shell-watchdog -> ${beside}`)
} catch {
  console.log(`shell-watchdog beside Udaan.exe is in use by a running guard; left as it is`)
}
