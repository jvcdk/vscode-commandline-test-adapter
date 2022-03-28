import * as child_process from 'child_process';
import * as fs from 'fs';

/**
 * Run external process.
 *
 * @param command Command to run
 * @param args Command arguments
 * @param cwd Working directory of command
 */
 export function runExternalProcess(
  command: string,
  args: Array<string>,
  cwd: string,
  translateNewlines: boolean,
  mergeStderrToStdout: boolean
): Promise<ExtProcessResult>
{
  let textFilter: (text: string) => string;
  if(translateNewlines)
    textFilter = (text: string) => text.replace(/\n/g, "\r\n");
  else
    textFilter = (text: string) => text;

  return new Promise<ExtProcessResult>((resolve, reject) => {
    let process: child_process.ChildProcessWithoutNullStreams;
    try {
      if(cwd != undefined && cwd != '') {
        // Note: statSync will throw an error if path doesn't exist
        if (!fs.statSync(cwd).isDirectory())
          throw new Error(`Directory '${cwd}' does not exist`);

        process = child_process.spawn( command, args, { cwd } );
      }
      else
        process = child_process.spawn( command, args );

      // Something failed, e.g. the executable or cwd doesn't exist
      if (!process.pid)
        throw new Error(`Cannot launch command '${command}'`);

      let result = new ExtProcessResult();
      let stdOut: string[] = [];
      let stdErr: string[] = [];
      process.stdout.on('data', (data: string) => stdOut.push(textFilter(String(data))));
      if(mergeStderrToStdout)
        process.stderr.on('data', (data: string) => stdOut.push(textFilter(String(data))));
      else
        process.stderr.on('data', (data: string) => stdErr.push(textFilter(String(data))));
      process.on('exit', (code) => {
        if(code === null)
          result.returnCode = 255;
        else
          result.returnCode = code;
        result.stdErr = stdErr.join("");
        result.stdOut = stdOut.join("");
        resolve(result);
      });
    } catch (e) {
      reject(e);
    }
  });
}

export class ExtProcessResult {
  public returnCode: number = 0;
  public stdOut: string = "";
  public stdErr: string = "";
}
