-- Teamrene CSPC Digital Clearance · schema v2 (MySQL / MariaDB)

CREATE TABLE IF NOT EXISTS programs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  college VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS sections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  program_id INT NOT NULL,
  year_level TINYINT NOT NULL,
  name VARCHAR(20) NOT NULL,
  UNIQUE KEY uq_section (program_id, year_level, name),
  FOREIGN KEY (program_id) REFERENCES programs(id)
);

CREATE TABLE IF NOT EXISTS subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  title VARCHAR(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS terms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  academic_year VARCHAR(9) NOT NULL,
  semester ENUM('1st Sem','2nd Sem','Summer') NOT NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_term (academic_year, semester)
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role ENUM('student','instructor','staff','admin') NOT NULL,
  given_name VARCHAR(80) NOT NULL,
  middle_name VARCHAR(80) NULL,
  family_name VARCHAR(80) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  email_status ENUM('unverified','verified') NOT NULL DEFAULT 'unverified',
  password_hash VARCHAR(100) NOT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  student_no VARCHAR(20) NULL UNIQUE,
  employee_id VARCHAR(20) NULL UNIQUE,
  department VARCHAR(100) NULL,
  program_id INT NULL,
  section_id INT NULL,
  year_level TINYINT NULL,
  college VARCHAR(100) NULL,
  office_code VARCHAR(10) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_sample TINYINT(1) NOT NULL DEFAULT 0,
  signature_image MEDIUMTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (program_id) REFERENCES programs(id),
  FOREIGN KEY (section_id) REFERENCES sections(id)
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  subject_id INT NOT NULL,
  section_id INT NOT NULL,
  term_id INT NOT NULL,
  UNIQUE KEY uq_enroll (student_id, subject_id, term_id),
  FOREIGN KEY (student_id) REFERENCES users(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (section_id) REFERENCES sections(id),
  FOREIGN KEY (term_id) REFERENCES terms(id)
);

CREATE TABLE IF NOT EXISTS teaching_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  instructor_id INT NOT NULL,
  subject_id INT NOT NULL,
  section_id INT NOT NULL,
  term_id INT NOT NULL,
  UNIQUE KEY uq_assign (instructor_id, subject_id, section_id, term_id),
  FOREIGN KEY (instructor_id) REFERENCES users(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (section_id) REFERENCES sections(id),
  FOREIGN KEY (term_id) REFERENCES terms(id)
);

CREATE TABLE IF NOT EXISTS offices (
  code VARCHAR(10) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS clearance_purposes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL UNIQUE,
  requires_explanation TINYINT(1) NOT NULL DEFAULT 0,
  instructor_stage TINYINT NULL DEFAULT 1,      -- NULL = instructors not required for this purpose
  deadline_days INT NULL,                        -- overall deadline after submission
  is_active TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS purpose_signatories (
  purpose_id INT NOT NULL,
  office_code VARCHAR(10) NOT NULL,
  stage TINYINT NOT NULL,
  PRIMARY KEY (purpose_id, office_code),
  FOREIGN KEY (purpose_id) REFERENCES clearance_purposes(id) ON DELETE CASCADE,
  FOREIGN KEY (office_code) REFERENCES offices(code)
);

CREATE TABLE IF NOT EXISTS clearance_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference_no VARCHAR(30) NOT NULL UNIQUE,
  student_id INT NOT NULL,
  purpose_id INT NOT NULL,
  purpose_other VARCHAR(120) NULL,
  term_id INT NOT NULL,
  status ENUM('in_progress','completed','cancelled') NOT NULL DEFAULT 'in_progress',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deadline_at DATETIME NULL,
  completed_at DATETIME NULL,
  INDEX idx_req_student (student_id, status),
  FOREIGN KEY (student_id) REFERENCES users(id),
  FOREIGN KEY (purpose_id) REFERENCES clearance_purposes(id),
  FOREIGN KEY (term_id) REFERENCES terms(id)
);

CREATE TABLE IF NOT EXISTS approvals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  office_code VARCHAR(10) NOT NULL,              -- 'INSTRUCTOR' for instructor approvals
  instructor_id INT NULL,
  subject_id INT NULL,
  subject_label VARCHAR(100) NULL,
  stage TINYINT NOT NULL,
  status ENUM('pending','on_hold','cleared') NOT NULL DEFAULT 'pending',
  eligible_at DATETIME NULL,
  due_at DATETIME NULL,
  acted_by INT NULL,
  acted_at DATETIME NULL,
  remarks VARCHAR(255) NULL,
  reminder_count INT NOT NULL DEFAULT 0,
  last_reminder_at DATETIME NULL,
  due_soon_notified_at DATETIME NULL,
  escalated_at DATETIME NULL,
  INDEX idx_appr_request (request_id),
  INDEX idx_appr_office (office_code, status),
  FOREIGN KEY (request_id) REFERENCES clearance_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (instructor_id) REFERENCES users(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (acted_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS compliance_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  approval_id INT NOT NULL,
  office_code VARCHAR(10) NOT NULL,
  kind ENUM('general','property','financial') NOT NULL DEFAULT 'general',
  description VARCHAR(255) NOT NULL,
  status ENUM('open','resolved') NOT NULL DEFAULT 'open',
  raised_by INT NOT NULL,
  raised_at DATETIME NOT NULL,
  resolved_by INT NULL,
  resolved_at DATETIME NULL,
  INDEX idx_comp_request (request_id, status),
  FOREIGN KEY (request_id) REFERENCES clearance_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (approval_id) REFERENCES approvals(id) ON DELETE CASCADE,
  FOREIGN KEY (raised_by) REFERENCES users(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS signatures (
  id INT AUTO_INCREMENT PRIMARY KEY,
  approval_id INT NOT NULL,
  request_id INT NOT NULL,
  user_id INT NOT NULL,
  role VARCHAR(20) NOT NULL,
  office_code VARCHAR(10) NOT NULL,
  stage TINYINT NOT NULL,
  action VARCHAR(20) NOT NULL,
  remarks VARCHAR(255) NULL,
  signature_hash CHAR(64) NOT NULL,
  signature_image MEDIUMTEXT NULL,
  ip VARCHAR(64) NULL,
  signed_at DATETIME NOT NULL,
  INDEX idx_sig_request (request_id),
  FOREIGN KEY (approval_id) REFERENCES approvals(id),
  FOREIGN KEY (request_id) REFERENCES clearance_requests(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS certificates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL UNIQUE,                 -- one certificate per request, enforced by the database
  token CHAR(32) NOT NULL UNIQUE,
  issued_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  revoked_reason VARCHAR(255) NULL,
  revoked_by INT NULL,
  used_at DATETIME NULL,
  used_by INT NULL,
  FOREIGN KEY (request_id) REFERENCES clearance_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (used_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS verification_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  certificate_id INT NOT NULL,
  result VARCHAR(10) NOT NULL,
  ip VARCHAR(64) NULL,
  scanned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (certificate_id) REFERENCES certificates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  request_id INT NULL,
  title VARCHAR(120) NOT NULL,
  body VARCHAR(400) NOT NULL,
  link VARCHAR(200) NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_user (user_id, is_read),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actor_id INT NULL,
  actor_label VARCHAR(160) NOT NULL,
  action VARCHAR(40) NOT NULL,
  entity VARCHAR(30) NOT NULL,
  entity_id INT NULL,
  request_id INT NULL,
  details VARCHAR(500) NULL,
  ip VARCHAR(64) NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_audit_request (request_id),
  INDEX idx_audit_time (created_at)
);

CREATE TABLE IF NOT EXISTS settings (
  key_name VARCHAR(40) PRIMARY KEY,
  value VARCHAR(120) NOT NULL
);
