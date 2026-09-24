/**
 * 极简 XML 解析(P7,StoryFlowXML 反向用)——只覆盖本格式发射的子集:
 * 处理指令 / 注释 / 自闭合 / 双引号属性 / 五个实体。结构错即抛。
 * 不做 DTD/命名空间/CDATA(本格式不发射)。
 */

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** 直接子文本拼接(已解实体;兼容视图)。 */
  text: string;
  /** 混合内容**保序**(文本段 | 子节点)——script 节的标记/文本/role 交错
   *  依赖此序还原。 */
  parts: Array<XmlNode | string>;
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const TAG_NAME_RE = /^[\p{L}_][\p{L}\p{N}._-]*/u;

/** 解析单根 XML 文档 → 根节点。 */
export const readXml = (xml: string): XmlNode => {
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let i = 0;

  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      const tail = xml.slice(i);
      if (stack.length) {
        stack[stack.length - 1].text += decodeEntities(tail);
        stack[stack.length - 1].parts.push(decodeEntities(tail));
      }
      i = xml.length;
      break;
    }
    if (lt > i && stack.length) {
      const chunk = decodeEntities(xml.slice(i, lt));
      stack[stack.length - 1].text += chunk;
      stack[stack.length - 1].parts.push(chunk);
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt);
      if (end < 0) throw new Error('XML: 未闭合的处理指令');
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt);
      if (end < 0) throw new Error('XML: 未闭合的注释');
      i = end + 3;
      continue;
    }

    // 标签本体(引号外找 '>')
    let j = lt + 1;
    let inQuote = false;
    while (j < xml.length) {
      const ch = xml[j];
      if (ch === '"') inQuote = !inQuote;
      else if (ch === '>' && !inQuote) break;
      j++;
    }
    if (j >= xml.length) throw new Error('XML: 未闭合的标签');
    const raw = xml.slice(lt + 1, j);
    i = j + 1;

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      const open = stack.pop();
      if (!open || open.tag !== name) {
        throw new Error(`XML: 标签错配 </${name}> 关闭了 <${open?.tag ?? '?'}>`);
      }
      if (!stack.length) {
        // 根闭合:尾随空白外不得再有元素
        const rest = xml.slice(i).trim();
        if (rest.startsWith('<')) throw new Error('XML: 根元素之后还有内容');
        i = xml.length;
      }
      continue;
    }

    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const nameMatch = TAG_NAME_RE.exec(body.trimStart());
    if (!nameMatch) throw new Error(`XML: 非法标签 <${raw}>`);
    const tag = nameMatch[0];
    const attrs: Record<string, string> = {};
    // 属性: name="value"(值内实体解码)
    const attrRe = /([\p{L}_][\p{L}\p{N}._-]*)\s*=\s*"([^"]*)"/gu;
    const rest = body.slice(body.trimStart().indexOf(tag) + tag.length);
    for (const m of rest.matchAll(attrRe)) {
      attrs[m[1]] = decodeEntities(m[2]);
    }

    const node: XmlNode = { tag, attrs, children: [], text: '', parts: [] };
    if (stack.length) {
      stack[stack.length - 1].children.push(node);
      stack[stack.length - 1].parts.push(node);
    }
    else if (root) throw new Error('XML: 多个根元素');
    else root = node;
    if (!selfClose) stack.push(node);
  }

  if (stack.length) throw new Error(`XML: 未闭合标签 <${stack[stack.length - 1].tag}>`);
  if (!root) throw new Error('XML: 空文档');
  return root;
};
