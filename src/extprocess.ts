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
): ExtProcessHandle
{
  let textFilter: (text: string) => string;
  if(translateNewlines)
    textFilter = (text: string) => text.replace(/\n/g, "\r\n");
  else
    textFilter = (text: string) => text;

  let child: child_process.ChildProcessWithoutNullStreams | undefined;

  const result = new Promise<ExtProcessResult>((resolve, reject) => {
    try {
      if(cwd != undefined && cwd != '') {
        if (!fs.statSync(cwd).isDirectory())
          throw new Error(`'${cwd}' is not a directory`);

        child = child_process.spawn( command, args, { cwd } );
      }
      else
        child = child_process.spawn( command, args );

      let result = new ExtProcessResult();
      let stdOut: string[] = [];
      let stdErr: string[] = [];

      child.on('error', reject);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (data: string) => stdOut.push(textFilter(data)));
      if(mergeStderrToStdout)
        child.stderr.on('data', (data: string) => stdOut.push(textFilter(data)));
      else
        child.stderr.on('data', (data: string) => stdErr.push(textFilter(data)));
      child.on('close', (code) => {
        result.returnCode = code ?? 255;
        result.stdErr = stdErr.join("");
        result.stdOut = stdOut.join("");
        resolve(result);
      });
    } catch (e) {
      reject(e);
    }
  });

  return {
    result,
    kill: () => child?.kill(),
  };
}

export interface ExtProcessHandle {
  result: Promise<ExtProcessResult>;
  kill: () => void;
}

export class ExtProcessResult {
  public returnCode: number = 0;
  public stdOut: string = "";
  public stdErr: string = "";
}
