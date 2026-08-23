/*
 * A small XML reader, because the Parliament publishes its roll-call annexes as
 * XML and this project has no dependencies. It handles what those files
 * actually contain — elements, attributes, text, CDATA, comments, entities —
 * and nothing else. It is not a general-purpose parser and validates nothing.
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (match, body) {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes[match[1]] = decodeEntities(match[3] !== undefined ? match[3] : match[4]);
  }
  return attributes;
}

/* Returns { name, attributes, children, text }. An element's text includes the
   text of its descendants, which is what every caller here wants. */
export function parseXML(source) {
  const root = { name: '#document', attributes: {}, children: [], text: '' };
  const stack = [root];
  let index = 0;

  const addText = function (raw) {
    const value = decodeEntities(raw);
    if (!value.trim()) return;
    stack[stack.length - 1].text += value;
  };

  while (index < source.length) {
    const open = source.indexOf('<', index);
    if (open === -1) {
      addText(source.slice(index));
      break;
    }
    if (open > index) addText(source.slice(index, open));

    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open);
      index = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open);
      stack[stack.length - 1].text += source.slice(open + 9, end === -1 ? source.length : end);
      index = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<?', open) || source.startsWith('<!', open)) {
      const end = source.indexOf('>', open);
      index = end === -1 ? source.length : end + 1;
      continue;
    }

    const close = source.indexOf('>', open);
    if (close === -1) break;
    const inner = source.slice(open + 1, close);

    if (inner[0] === '/') {
      const finished = stack.pop();
      if (stack.length && finished) stack[stack.length - 1].text += finished.text;
      index = close + 1;
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const space = body.search(/\s/);
    const name = space === -1 ? body : body.slice(0, space);
    const node = {
      name: name,
      attributes: space === -1 ? {} : parseAttributes(body.slice(space)),
      children: [],
      text: ''
    };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    index = close + 1;
  }

  return root;
}

/* Depth-first search by tag name. The Parliament writes tag names two ways —
   dotted (RollCallVote.Result.For) in the annexes, namespace-prefixed
   (vcard:hasLocality) in the RDF — so both separators are accepted as a
   prefix: findAll(doc, 'hasLocality') finds vcard:hasLocality. */
export function findAll(node, name) {
  const wanted = name.toLowerCase();
  const found = [];
  (function walk(current) {
    current.children.forEach(function (child) {
      const label = child.name.toLowerCase();
      if (label === wanted || label.endsWith('.' + wanted) || label.endsWith(':' + wanted)) {
        found.push(child);
      }
      walk(child);
    });
  })(node);
  return found;
}

export function find(node, name) {
  return findAll(node, name)[0] || null;
}

/* Every distinct tag path in a document, with counts. The --inspect flag prints
   this so a changed schema can be seen rather than guessed at. */
export function outline(node, prefix, sink) {
  const counts = sink || new Map();
  node.children.forEach(function (child) {
    const path = (prefix ? prefix + ' > ' : '') + child.name;
    counts.set(path, (counts.get(path) || 0) + 1);
    outline(child, path, counts);
  });
  return counts;
}
