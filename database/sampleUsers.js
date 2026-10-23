// SAMPLE accounts (made-up names for demos; clearly flagged is_sample in the database).
// Match key for upgrades is employee_id / student_no, so names can be changed here without touching passwords or history.
const COLLEGE = 'College of Computer Studies';

const instructors = [
  ['Noel', 'Paguio'], ['Ana', 'Reyes'], ['Challiz', 'Omorog'],            // teach BSIT 2C
  ['Maribel', 'Nacario'], ['Ramon', 'Buenaflor'], ['Jocelyn', 'Ordoñez'], // teach BSIT 2D
  ['Eduardo', 'Belmonte'],                                                  // not assigned yet
];

// 3 people per office, in this order (employee IDs EMP-2000 …)
const offices = [
  ['ACCT', 'Acct', [['Rowena', 'Cabrera'], ['Teodoro', 'Salazar'], ['Marites', 'Fuentes']]],
  ['GUID', 'Guid', [['Lourdes', 'Alcantara'], ['Benjamin', 'Rosales'], ['Cynthia', 'Mercado']]],
  ['SAS', 'Sas', [['Armando', 'Villareal'], ['Glenda', 'Pascual'], ['Rodel', 'Santiago']]],
  ['ALUM', 'Alum', [['Felicidad', 'Navarro'], ['Gilbert', 'Aguilar'], ['Imelda', 'Castillo']]],
  ['CSC', 'Csc', [['Jerome', 'Dizon'], ['Katrina', 'Valdez'], ['Paolo', 'Manalo']]],
  ['LIB', 'Lib', [['Teresita', 'Bautista'], ['Rolando', 'Esguerra'], ['Analyn', 'Soriano']]],
  ['LAB', 'Lab', [['Dennis', 'Pineda'], ['Josephine', 'Ramos'], ['Arnel', 'Tolentino']]],
  ['REG', 'Reg', [['Corazon', 'Evangelista'], ['Wilfredo', 'Mendoza'], ['Shirley', 'Panganiban']]],
];

function people() {
  const p = [
    { role: 'admin', given: 'System', family: 'Admin', password: 'Admin@Teamrene1', employee_id: 'EMP-0001' },
    { role: 'student', given: 'Pia Jane', family: 'Lastrollo', password: 'stud123', student_no: '2022-0001', section: 'BSIT 2C' },
    { role: 'student', given: 'Analiza', family: 'Minulas', password: 'stud234', student_no: '2022-0002', section: 'BSIT 2D' },
  ];
  instructors.forEach(([given, family], i) => p.push({ role: 'instructor', given, family, password: 'instructor' + (i + 1), employee_id: 'EMP-' + (1001 + i), dept: 'CCS' }));
  let n = 2000;
  for (const [code, pre, names] of offices) {
    names.forEach(([given, family], i) => p.push({ role: 'staff', given, family, password: pre + (i + 1) + '#Cspc26', employee_id: 'EMP-' + n++, office: code }));
  }
  p.push({ role: 'staff', given: 'Rosel', family: 'Onesa', password: 'Dean#2026', employee_id: 'EMP-3001', office: 'DEAN', college: COLLEGE });
  p.push({ role: 'staff', given: 'Gregorio', family: 'Almazan', password: 'DeptHead#2026', employee_id: 'EMP-3002', office: 'DEPT', college: COLLEGE });
  return p;
}

module.exports = { COLLEGE, people };
