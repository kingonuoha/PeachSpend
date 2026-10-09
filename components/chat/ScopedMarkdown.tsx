import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Radii, Spacing, Typography } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';

// FR-07.10 scoped markdown. Only bold, italic, bulleted/numbered lists, and
// simple 2-3 column tables are interpreted. Every other construct (headers,
// block quotes, code blocks, nested lists) is left as plain text so unsupported
// syntax never renders as broken markup.

interface InlineSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

const INLINE_TOKEN = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
const BULLET_LINE = /^[-*]\s+(.*)$/;
const NUMBERED_LINE = /^\d+\.\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|?\s*$/;
const MAX_TABLE_COLUMNS = 3;

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; header: string[]; rows: string[][] };

function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_TOKEN.lastIndex = 0;
  while ((match = INLINE_TOKEN.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ text: text.slice(lastIndex, match.index) });
    const token = match[1];
    if (token.startsWith('**')) segments.push({ text: token.slice(2, -2), bold: true });
    else segments.push({ text: token.slice(1, -1), italic: true });
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex) });
  return segments.length > 0 ? segments : [{ text }];
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    // Table: header line plus a separator line, capped at 3 columns.
    if (line.includes('|') && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1]) && !/^\s*\|?[\s:|-]*$/.test(line)) {
      const header = splitTableRow(line);
      if (header.length >= 2 && header.length <= MAX_TABLE_COLUMNS) {
        const rows: string[][] = [];
        let cursor = index + 2;
        while (cursor < lines.length && lines[cursor].includes('|') && !TABLE_SEPARATOR.test(lines[cursor])) {
          const row = splitTableRow(lines[cursor]);
          if (row.length === header.length) rows.push(row);
          cursor += 1;
        }
        flushParagraph();
        blocks.push({ type: 'table', header, rows });
        index = cursor - 1;
        continue;
      }
    }

    const bullet = BULLET_LINE.exec(line);
    if (bullet) {
      flushParagraph();
      const items = [bullet[1]];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const next = BULLET_LINE.exec(lines[cursor]);
        if (!next) break;
        items.push(next[1]);
        cursor += 1;
      }
      blocks.push({ type: 'list', ordered: false, items });
      index = cursor - 1;
      continue;
    }

    const numbered = NUMBERED_LINE.exec(line);
    if (numbered) {
      flushParagraph();
      const items = [numbered[1]];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const next = NUMBERED_LINE.exec(lines[cursor]);
        if (!next) break;
        items.push(next[1]);
        cursor += 1;
      }
      blocks.push({ type: 'list', ordered: true, items });
      index = cursor - 1;
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

function InlineText({ content, style }: { content: string; style: object }) {
  const segments = useMemo(() => parseInline(content), [content]);
  return (
    <Text style={style}>
      {segments.map((segment, index) => (
        <Text
          key={index}
          style={{
            fontFamily: segment.bold
              ? 'Manrope_700Bold'
              : segment.italic
                ? 'Manrope_400Regular'
                : undefined,
            fontStyle: segment.italic ? 'italic' : 'normal',
          }}
        >
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

export function ScopedMarkdown({ content, color }: { content: string; color?: string }) {
  const ts = useThemeStyles();
  const textColor = color ?? ts.text.onSurface;
  const blocks = useMemo(() => parseBlocks(content), [content]);
  const bodyStyle = { ...Typography.labelMd, color: textColor, fontSize: 13, lineHeight: 19 };

  return (
    <View style={{ gap: Spacing.s2 }}>
      {blocks.map((block, index) => {
        if (block.type === 'paragraph') {
          return <InlineText key={index} content={block.text} style={bodyStyle} />;
        }
        if (block.type === 'list') {
          return (
            <View key={index} style={{ gap: Spacing.s1 }}>
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} style={{ flexDirection: 'row', gap: Spacing.s2 }}>
                  <Text style={[Typography.labelMd, { color: ts.text.primary, fontSize: 13, lineHeight: 19 }]}>
                    {block.ordered ? `${itemIndex + 1}.` : '\u2022'}
                  </Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <InlineText content={item} style={bodyStyle} />
                  </View>
                </View>
              ))}
            </View>
          );
        }
        return (
          <View
            key={index}
            style={{
              borderWidth: 1,
              borderColor: ts.raw.outline,
              borderRadius: Radii.sm,
              overflow: 'hidden',
            }}
          >
            <View style={{ flexDirection: 'row', backgroundColor: ts.raw.purple100 }}>
              {block.header.map((cell, cellIndex) => (
                <View key={cellIndex} style={{ flex: 1, minWidth: 0, padding: Spacing.s2 }}>
                  <Text
                    numberOfLines={2}
                    style={[
                      Typography.micro,
                      { color: ts.text.onSurface, fontFamily: 'Manrope_700Bold' },
                      cellIndex === block.header.length - 1 ? { textAlign: 'right' } : null,
                    ]}
                  >
                    {cell}
                  </Text>
                </View>
              ))}
            </View>
            {block.rows.map((row, rowIndex) => (
              <View
                key={rowIndex}
                style={{
                  flexDirection: 'row',
                  borderTopWidth: 1,
                  borderTopColor: ts.raw.outline,
                }}
              >
                {row.map((cell, cellIndex) => (
                  <View key={cellIndex} style={{ flex: 1, minWidth: 0, padding: Spacing.s2 }}>
                    <InlineText
                      content={cell}
                      style={[
                        bodyStyle,
                        cellIndex === row.length - 1 ? { textAlign: 'right' } : null,
                      ]}
                    />
                  </View>
                ))}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}
