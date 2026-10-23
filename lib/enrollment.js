// Which instructors must sign for a student? Decided from ACTUAL enrollment and teaching assignments
// (same subject + same section + same term), never from the section name alone.
function instructorSignatories(enrollments, assignments) {
  const out = [], seen = new Set();
  for (const e of enrollments) {
    for (const t of assignments) {
      if (t.subject_id === e.subject_id && t.section_id === e.section_id && t.term_id === e.term_id) {
        const key = t.instructor_id + ':' + e.subject_id;
        if (!seen.has(key)) { seen.add(key); out.push({ instructor_id: t.instructor_id, subject_id: e.subject_id, subject_label: e.subject_code }); }
      }
    }
  }
  return out;
}

module.exports = { instructorSignatories };
