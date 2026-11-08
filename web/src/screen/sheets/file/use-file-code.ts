import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnalysisResult } from '../../../data/generated/AnalysisResult'
import type { ResultIndex } from '../../result-index'
import type { CodeState } from '../sheet-data'
import { fetchCode } from './github-code'

const LOADING_CODE: CodeState = { status: 'loading' }

export interface FileCode {
  /** The code of a file as it stands: loading until its own code came. */
  codeOf: (path: string) => CodeState
  /** Reads the file's code again. */
  loadCode: (path: string) => void
  /** Reads the selected file's code, once its tab shows: never twice for one file. */
  openCode: () => void
}

/** The selected file's code, read from GitHub. */
export function useFileCode(
  result: AnalysisResult,
  index: ResultIndex,
  selectedFile: string | null,
): FileCode {
  // The code of one file at one commit: another result, even of the same repository, reads it again.
  const [code, setCode] = useState<{ sha: string; path: string; state: CodeState } | null>(null)
  const codeRequest = useRef<AbortController | null>(null)
  const loadCode = useCallback(
    (path: string) => {
      codeRequest.current?.abort()
      const controller = new AbortController()
      codeRequest.current = controller
      const { sha } = result
      setCode({ sha, path, state: LOADING_CODE })
      const file = index.fileAt(path)
      const lines = file === undefined ? 0 : (result.files.lines[file] ?? 0)
      fetchCode(result.repo, sha, path, lines, controller.signal).then(
        (state) => {
          if (!controller.signal.aborted) {
            setCode({ sha, path, state })
          }
        },
        () => {},
      )
    },
    [index, result],
  )
  useEffect(() => () => codeRequest.current?.abort(), [])
  const codeFor = code ? `${code.sha}:${code.path}` : null
  const openCode = useCallback(() => {
    if (selectedFile && codeFor !== `${result.sha}:${selectedFile}`) {
      loadCode(selectedFile)
    }
  }, [selectedFile, codeFor, result.sha, loadCode])
  const codeOf = useCallback(
    (path: string) => (code?.path === path && code.sha === result.sha ? code.state : LOADING_CODE),
    [code, result.sha],
  )
  return { codeOf, loadCode, openCode }
}
