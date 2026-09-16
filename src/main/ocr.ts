import { app, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createWorker, type Worker } from 'tesseract.js'
import { parseCardLines, type OcrLine } from '../shared/cardParse'
import type { OcrScanResult } from '../shared/types'

let workerPromise: Promise<Worker> | null = null

/** 워커는 최초 1회 생성 후 재사용. traineddata(kor+eng)는 최초 실행 시 다운로드되어 userData에 캐시 */
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const cachePath = path.join(app.getPath('userData'), 'tessdata')
    fs.mkdirSync(cachePath, { recursive: true })
    workerPromise = createWorker(['kor', 'eng'], 1, { cachePath })
  }
  return workerPromise
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}

export function imageToDataUrl(filePath: string): string {
  const mime = MIME[path.extname(filePath).toLowerCase()] ?? 'image/png'
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`
}

interface TessLine {
  text?: string
  bbox?: { y0: number; y1: number }
}

/** recognize 결과(blocks)에서 라인 텍스트+높이 추출. blocks가 없으면 plain text 라인으로 폴백 */
function extractLines(data: {
  text: string
  blocks?: { paragraphs?: { lines?: TessLine[] }[] }[] | null
}): OcrLine[] {
  const lines: OcrLine[] = []
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const text = (line.text ?? '').trim()
        if (!text) continue
        const height = line.bbox ? line.bbox.y1 - line.bbox.y0 : undefined
        lines.push({ text, height })
      }
    }
  }
  if (lines.length > 0) return lines
  return data.text.split(/\r?\n/).map((text) => ({ text }))
}

/** 명함 이미지 선택 → 앱 폴더로 복사 → OCR → 필드 추출. 취소 시 null */
export async function pickAndScanCard(): Promise<OcrScanResult | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '명함 이미지 선택',
    filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
    properties: ['openFile']
  })
  if (canceled || filePaths.length === 0) return null

  const src = filePaths[0]
  const cardsDir = path.join(app.getPath('userData'), 'cards')
  fs.mkdirSync(cardsDir, { recursive: true })
  const dest = path.join(cardsDir, `${randomUUID().slice(0, 8)}${path.extname(src).toLowerCase()}`)
  fs.copyFileSync(src, dest)

  const worker = await getWorker()
  const { data } = await worker.recognize(dest, {}, { blocks: true, text: true })
  const lines = extractLines(data as Parameters<typeof extractLines>[0])
  const fields = parseCardLines(lines)

  return {
    fields,
    imagePath: dest,
    imageDataUrl: imageToDataUrl(dest),
    rawText: data.text
  }
}
