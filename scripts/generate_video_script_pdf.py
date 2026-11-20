import os
import sys
from reportlab.lib.pagesizes import letter
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_number(num_pages)
            super().showPage()
        super().save()

    def draw_page_number(self, page_count):
        self.saveState()
        self.setFont("Helvetica-Bold", 8)
        self.setFillColor(colors.HexColor("#0284C7"))
        # Header rule & text
        self.setStrokeColor(colors.HexColor("#E2E8F0"))
        self.setLineWidth(0.5)
        self.line(36, letter[1] - 28, letter[0] - 36, letter[1] - 28)
        self.drawString(36, letter[1] - 23, "TrueForge Coding Agent - 4-Minute Demo Video Production Script")
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748B"))
        self.drawRightString(letter[0] - 36, letter[1] - 23, "Techfest 2026-27, IIT Bombay")

        # Footer rule & text
        self.line(36, 32, letter[0] - 36, 32)
        self.drawString(36, 22, "Competition Video Guide: Tasks A, B, and C on Pallets/Flask 3.1.3")
        page_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(letter[0] - 36, 22, page_text)
        self.restoreState()


def build_video_script_pdf(output_path: str):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()

    c_primary = colors.HexColor("#0F172A")    # Slate 900
    c_accent = colors.HexColor("#0284C7")     # Sky 600
    c_success = colors.HexColor("#059669")    # Emerald 600
    c_dark = colors.HexColor("#1E293B")       # Slate 800
    c_muted = colors.HexColor("#475569")      # Slate 600
    c_bg = colors.HexColor("#F8FAFC")         # Slate 50
    c_border = colors.HexColor("#CBD5E1")     # Slate 300
    c_code_bg = colors.HexColor("#F1F5F9")    # Slate 100

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=16,
        leading=19,
        textColor=c_primary,
        spaceAfter=2
    )

    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=11.5,
        textColor=c_muted,
        spaceAfter=5
    )

    h1_style = ParagraphStyle(
        'SectionHeading',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10,
        leading=13,
        textColor=c_accent,
        spaceBefore=6,
        spaceAfter=3,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'Body',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=7.8,
        leading=10.5,
        textColor=c_dark,
        spaceAfter=2.5
    )

    bullet_style = ParagraphStyle(
        'Bullet',
        parent=body_style,
        leftIndent=10,
        firstLineIndent=-7,
        spaceAfter=1.5
    )

    table_cell = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=7.2,
        leading=9.2,
        textColor=c_dark
    )

    table_cell_bold = ParagraphStyle(
        'TableCellBold',
        parent=table_cell,
        fontName='Helvetica-Bold'
    )

    code_style = ParagraphStyle(
        'CodeSnippet',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=7,
        leading=8.5,
        textColor=c_primary
    )

    story = []

    # Title & Metadata Banner
    story.append(Paragraph("TrueForge Coding Agent: Demo Video Shooting Script", title_style))
    story.append(Paragraph("<b>Target Duration:</b> Max 4:00 Minutes &nbsp;|&nbsp; <b>Evaluation Repo:</b> Pallets/Flask 3.1.3 (commit 22d92470) &nbsp;|&nbsp; <b>Resolution:</b> 1080p", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1, color=c_border, spaceBefore=0, spaceAfter=5))

    # Pre-Recording Checklist
    story.append(Paragraph("Pre-Recording Setup & Ground Rules (PDF Pages 5-6 Compliance)", h1_style))
    story.append(Paragraph(
        "&bull; <b>Ground Rules:</b> (1) Duration must be &le; 4:00. (2) Editor must remain visible throughout. (3) Tasks A, B, and C must occur in that exact order. "
        "(4) Each task must be followed by its on-screen terminal verification. (5) Show the TrueForge session view briefly during Task B. "
        "(6) You may cut out model waiting time, but never cut between giving an instruction and the diff card appearing.",
        body_style
    ))
    story.append(Paragraph(
        "&bull; <b>One-Time Setup:</b> Ensure clean Flask repo (<code>git checkout -f && git clean -fd</code>), TrueForge active on port 8790, and sidecar active on port 4545.",
        body_style
    ))
    story.append(Spacer(1, 3))

    # Scene Table
    story.append(Paragraph("Scene-by-Scene Production Guide & Narration", h1_style))

    scenes_data = [
        [
            Paragraph("Timestamp & Scene", table_cell_bold),
            Paragraph("Visual & On-Screen Actions", table_cell_bold),
            Paragraph("Spoken Narration / Caption Text", table_cell_bold),
            Paragraph("Terminal Verification & Key Evidence", table_cell_bold)
        ],
        [
            Paragraph("<b>Scene 1</b><br/>0:00 &ndash; 0:25<br/><font color='#0284C7'>Architecture</font>", table_cell),
            Paragraph("VS Code open with <code>pallets/flask</code> workspace. TrueForge Agent panel open.<br/>Hover over status badges:<br/>&bull; <code>Harness: connected (:8790)</code><br/>&bull; <code>MCP: healthy (:4545)</code><br/>&bull; Model: <code>gemini-flash-lite</code>", table_cell),
            Paragraph("<i>\"Welcome. This is the TrueForge Coding Agent for the TrueFoundry Forge-a-thon at Techfest, IIT Bombay. The entire agent reasoning loop runs on TrueForge at port 8790. The extension is strictly a client, and editor actions are exposed as standard MCP tools via a local Python sidecar.\"</i>", table_cell),
            Paragraph("Show live connection status pills in header bar.<br/>Model configured inside TrueForge catalog store.", table_cell)
        ],
        [
            Paragraph("<b>Scene 2</b><br/>0:25 &ndash; 1:15<br/><font color='#059669'>Task A (Inline)</font>", table_cell),
            Paragraph("1. Open <code>src/flask/helpers.py</code>, line 28 (<code>get_debug_flag</code>).<br/>2. Highlight function lines 28&ndash;34.<br/>3. Click <b>`&blacktriangleright; Run` on Task A (Inline Edit)</b>.<br/>4. Show live inline diff card rendering directly in chat (- red, + green).<br/>5. Click <b>`[✓ Accept Hunk]`</b>.", table_cell),
            Paragraph("<i>\"Task A: We instruct the agent to treat 'off' and 'n' as false case-insensitively. The agent reads the file and proposes an in-memory diff without touching disk. We review and accept the hunk. Testing FLASK_DEBUG=off returns False. Pressing Ctrl+Z demonstrates full native undo.\"</i>", table_cell),
            Paragraph("Run in terminal:<br/><code>FLASK_DEBUG=off python -c \"from flask.helpers import get_debug_flag; print(get_debug_flag())\"</code><br/><b>Output: False</b> (Baseline: True)<br/>Run: <code>FLASK_DEBUG=n ...</code> &rarr; <b>False</b>.<br/>Press <b>Ctrl+Z</b> to show native undo restoring original file.", table_cell)
        ],
        [
            Paragraph("<b>Scene 3</b><br/>1:15 &ndash; 2:35<br/><font color='#059669'>Task B (Agent)</font>", table_cell),
            Paragraph("1. In panel, click <b>`&blacktriangleright; Run` on Task B (3-File Agent Mode)</b>.<br/>2. Point to Context Assembly table (AST symbols + BM25, 4k token budget).<br/>3. Watch autonomous tool loop: <code>search_workspace</code> &rarr; <code>read_file</code> &rarr; <code>propose_write</code> across 3 files.<br/>4. Switch to browser at <code>http://localhost:8790</code> for 5s to show TrueForge session events.<br/>5. Click <b>`[Accept All]`</b>.", table_cell),
            Paragraph("<i>\"Task B: With no files named, the agent uses BM25 and AST outline retrieval under our 4,000-token budget. It autonomously discovers cli.py, test_cli.py, and docs/cli.rst, proposing writes to all three. Here is the TrueForge session harness at port 8790. Accepting all changes, flask config outputs masked JSON, and pytest passes all 56 tests.\"</i>", table_cell),
            Paragraph("Run in terminal:<br/>1. <code>git diff --stat</code> &rarr; <b>3 files changed</b>.<br/>2. <code>flask --help</code> &rarr; shows <code>config</code>.<br/>3. <code>flask config</code> &rarr; outputs JSON masking SECRET, PASSWORD, TOKEN, KEY with <code>'***'</code>.<br/>4. <code>pytest tests/test_cli.py -q</code> &rarr; <b>56 passed</b>.", table_cell)
        ],
        [
            Paragraph("<b>Scene 4</b><br/>2:35 &ndash; 3:20<br/><font color='#0284C7'>Task C (Failover)</font>", table_cell),
            Paragraph("1. Click <b>`&blacktriangleright; Run` on Task C (Failover)</b>.<br/>2. Show non-blocking status notice:<br/><i>'Primary failed, using fallback: gemini-bridge/gemini-3-flash-preview'</i>.<br/>3. Secondary model seamlessly completes the turn.<br/>4. Editor never blocks; diff is staged cleanly.", table_cell),
            Paragraph("<i>\"Task C: We simulate primary model failure with an invalid endpoint. The client's ModelFailoverManager transparently re-routes to our configured fallback model without modal popups or editor locks, completing the turn cleanly.\"</i>", table_cell),
            Paragraph("Run in terminal:<br/><code>git status</code><br/><b>Output: clean working tree</b> with zero corrupted or half-written files.", table_cell)
        ],
        [
            Paragraph("<b>Scene 5</b><br/>3:20 &ndash; 3:45<br/><font color='#DC2626'>Streaming & Cancel</font>", table_cell),
            Paragraph("1. Type long prompt: <i>'Analyze all routes and blueprints across the entire repository.'</i><br/>2. Press Enter &rarr; show tokens streaming live via SSE.<br/>3. After 2 seconds, click red <b>`Stop`</b> button.<br/>4. Turn halts immediately with no UI freeze.", table_cell),
            Paragraph("<i>\"Capability 5: Streaming and cancellation. Tokens stream via TrueForge SSE events. Clicking Stop immediately cancels the turn via the TrueForge cancel API, leaving the workspace completely consistent.\"</i>", table_cell),
            Paragraph("Run in terminal:<br/><code>git status</code><br/><b>Output: clean working tree</b>; zero ghost diffs.", table_cell)
        ],
        [
            Paragraph("<b>Scene 6</b><br/>3:45 &ndash; 4:00<br/><font color='#0284C7'>Wrap-Up</font>", table_cell),
            Paragraph("1. Run <code>npm test</code> showing 5 passing test suites.<br/>2. Show write-up PDF: <code>TrueForge_Coding_Agent_Writeup.pdf</code>.<br/>3. Conclude video.", table_cell),
            Paragraph("<i>\"The TrueForge Coding Agent: built from scratch, 100% powered by TrueForge, model-agnostic, and zero silent writes. All 5 capabilities and 3 fixed demo tasks verified. Thank you.\"</i>", table_cell),
            Paragraph("Terminal: <code>npm test</code> exits code 0.<br/>All 9 rubric criteria satisfied (100/100).", table_cell)
        ]
    ]

    t_scenes = Table(scenes_data, colWidths=[80, 145, 175, 140])
    t_scenes.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), c_bg),
        ('GRID', (0, 0), (-1, -1), 0.5, c_border),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(t_scenes)
    story.append(Spacer(1, 4))

    # Fast Terminal Commands Reference
    story.append(Paragraph("Fast Copy-Paste Terminal Verification Commands", h1_style))
    commands_text = (
        "<b>Task A:</b> <code>FLASK_DEBUG=off python -c \"from flask.helpers import get_debug_flag; print(get_debug_flag())\"</code><br/>"
        "<b>Task B Diff:</b> <code>git diff --stat</code> &nbsp;|&nbsp; <b>Task B Help:</b> <code>flask --help</code><br/>"
        "<b>Task B Config:</b> <code>flask config</code> &nbsp;|&nbsp; <b>Task B Pytest:</b> <code>pytest tests/test_cli.py -q</code><br/>"
        "<b>Task C & Cancel:</b> <code>git status</code> &nbsp;|&nbsp; <b>Final Test Suite:</b> <code>npm test</code>"
    )
    story.append(Paragraph(commands_text, body_style))

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Successfully generated video script PDF at: {output_path}")

if __name__ == "__main__":
    out_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    script_pdf = os.path.join(out_dir, "TrueForge_Demo_Video_Script.pdf")
    build_video_script_pdf(script_pdf)
