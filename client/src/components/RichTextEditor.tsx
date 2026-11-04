import { useEffect, type ReactNode } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { MERGE_FIELDS } from '@fap/shared';

function ToolButton({ editor, active, onClick, label, children }: { editor: Editor; active?: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={!editor.isEditable}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`min-w-9 rounded px-2 py-1.5 text-sm font-medium ${active ? 'bg-brand text-white' : 'text-slate-700 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  );
}

/** Agreement editor: headings, bold, lists and numbered clauses, plus merge fields (PRD AD7). */
export function RichTextEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: false,
        code: false,
        codeBlock: false,
      }),
    ],
    content: value,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: 'agreement-content min-h-[420px] px-4 py-3 focus:outline-none', 'aria-label': 'Agreement text' },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // Load new content when a different version is opened.
  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;
  const chain = () => editor.chain().focus();

  return (
    <div className="rounded-md border border-slate-300 bg-white focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1.5" role="toolbar" aria-label="Formatting">
        <ToolButton editor={editor} label="Heading" active={editor.isActive('heading', { level: 2 })} onClick={() => chain().toggleHeading({ level: 2 }).run()}>H1</ToolButton>
        <ToolButton editor={editor} label="Sub-heading" active={editor.isActive('heading', { level: 3 })} onClick={() => chain().toggleHeading({ level: 3 }).run()}>H2</ToolButton>
        <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden />
        <ToolButton editor={editor} label="Bold" active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()}><strong>B</strong></ToolButton>
        <ToolButton editor={editor} label="Italic" active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()}><em>I</em></ToolButton>
        <ToolButton editor={editor} label="Underline" active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()}><u>U</u></ToolButton>
        <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden />
        <ToolButton editor={editor} label="Bullet list" active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()}>• List</ToolButton>
        <ToolButton editor={editor} label="Numbered clauses" active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()}>1. List</ToolButton>
        <ToolButton editor={editor} label="Quote" active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()}>❝</ToolButton>
        <ToolButton editor={editor} label="Divider line" onClick={() => chain().setHorizontalRule().run()}>―</ToolButton>
        <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden />
        <ToolButton editor={editor} label="Undo" onClick={() => chain().undo().run()}>↶</ToolButton>
        <ToolButton editor={editor} label="Redo" onClick={() => chain().redo().run()}>↷</ToolButton>

        <select
          className="ml-auto rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          aria-label="Insert merge field"
          value=""
          onChange={(e) => {
            if (e.target.value) chain().insertContent(`{{${e.target.value}}}`).run();
          }}
        >
          <option value="">Insert merge field…</option>
          {MERGE_FIELDS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
