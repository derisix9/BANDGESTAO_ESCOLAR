-- ==========================================================
-- SISTEMA DE GESTÃO ESCOLAR (BandMed / EduGest)
-- Base de Dados MySQL Completa (Esquema + Dados de Demonstração)
-- Compatível com: MySQL 5.7 / 8.0+, MariaDB, phpMyAdmin e MySQL Workbench
-- Codificação: UTF-8 Unicode (utf8mb4_unicode_ci)
-- ==========================================================

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

DROP TABLE IF EXISTS `book_loans`;
DROP TABLE IF EXISTS `library_books`;
DROP TABLE IF EXISTS `notices`;
DROP TABLE IF EXISTS `timetables`;
DROP TABLE IF EXISTS `tuition_fees`;
DROP TABLE IF EXISTS `grade_records`;
DROP TABLE IF EXISTS `exams`;
DROP TABLE IF EXISTS `attendance_records`;
DROP TABLE IF EXISTS `attendance_sheets`;
DROP TABLE IF EXISTS `teacher_allocations`;
DROP TABLE IF EXISTS `subjects`;
DROP TABLE IF EXISTS `classes`;
DROP TABLE IF EXISTS `teachers`;
DROP TABLE IF EXISTS `students`;
DROP TABLE IF EXISTS `system_settings`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `roles`;

-- --------------------------------------------------------
-- 1. Tabela: roles (Perfis de Acesso)
-- --------------------------------------------------------
CREATE TABLE `roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(50) NOT NULL UNIQUE,
  `label` VARCHAR(100) NOT NULL,
  `description` TEXT,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `roles` (`id`, `name`, `label`, `description`) VALUES
(1, 'admin', 'Administrador Geral', 'Acesso irrestrito a configurações, finanças e auditoria'),
(2, 'professor', 'Professor / Docente', 'Lançamento de notas, sumários e registo diário de assiduidade'),
(3, 'aluno', 'Aluno / Estudante', 'Consulta de notas, assiduidade, horário escolar e avisos'),
(4, 'encarregado', 'Encarregado de Educação', 'Acompanhamento do educando, propinas, assiduidade e avisos');

-- --------------------------------------------------------
-- 2. Tabela: users (Utilizadores do Sistema)
-- --------------------------------------------------------
CREATE TABLE `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(50) DEFAULT NULL,
  `avatar` VARCHAR(255) DEFAULT NULL,
  `status` ENUM('ativo', 'inativo', 'suspenso') DEFAULT 'ativo',
  `remember_token` VARCHAR(100) DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_users_role` (`role_id`),
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Contas de demonstração: SÓ para ambiente local de testes. Nunca importar em produção.
INSERT INTO `users` (`id`, `role_id`, `name`, `email`, `password`, `phone`, `avatar`, `status`) VALUES
(1, 1, 'Dr. Carlos Mendes', 'admin@escola.pt', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '+244 923 110 490', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150', 'ativo'),
(2, 2, 'Prof.ª Marta Fontes', 'prof.marta@escola.pt', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '+244 912 345 678', 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150', 'ativo'),
(3, 3, 'Tiago André Silva', 'aluno.tiago@escola.pt', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '+244 928 903 551', 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150', 'ativo'),
(4, 4, 'Dr. Miguel Ferreira Silva', 'encarregado.silva@escola.pt', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '+244 912 345 678', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150', 'ativo');

-- --------------------------------------------------------
-- 3. Tabela: teachers (Professores / Corpo Docente)
-- --------------------------------------------------------
CREATE TABLE `teachers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED DEFAULT NULL,
  `agent_number` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL UNIQUE,
  `phone` VARCHAR(50) NOT NULL,
  `bi_number` VARCHAR(50) DEFAULT NULL,
  `nif` VARCHAR(50) DEFAULT NULL,
  `department` VARCHAR(100) NOT NULL,
  `degree` VARCHAR(191) NOT NULL,
  `bio` TEXT,
  `weekly_hours` INT UNSIGNED DEFAULT 20,
  `status` ENUM('ativo', 'licenca', 'contrato_vencer') DEFAULT 'ativo',
  `rating` DECIMAL(3,2) DEFAULT 5.00,
  `admission_date` DATE DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_teachers_user` (`user_id`),
  CONSTRAINT `fk_teachers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `teachers` (`id`, `user_id`, `agent_number`, `name`, `email`, `phone`, `bi_number`, `nif`, `department`, `degree`, `bio`, `weekly_hours`, `status`, `rating`, `admission_date`) VALUES
(1, NULL, 'AG-9041', 'Prof. João Figueiredo', 'j.figueiredo@bandmed.ao', '+244 923 481 092', '004819201LA042', '5419082402', 'Ciências Exatas', 'Mestrado em Ensino da Matemática (UAN)', 'Regente de Matemática e Estatística Aplicada.', 24, 'ativo', 4.80, '2019-02-12'),
(2, NULL, 'AG-8820', 'Dra. Beatriz Cambuta', 'b.cambuta@bandmed.ao', '+244 944 112 559', '005118933BE019', '5419088102', 'Saúde / Biológicas', 'Doutoramento em Ciências Biomédicas', 'Coordenadora de Ciências Biomédicas e Enfermagem.', 20, 'ativo', 4.90, '2020-09-01'),
(3, NULL, 'AG-7114', 'Prof. Manuel Kitumba', 'm.kitumba@bandmed.ao', '+244 912 300 871', '001099238KS099', '5409118409', 'Letras & Humanidades', 'Licenciatura em Língua Portuguesa', 'Docente de Língua Portuguesa e Literatura.', 0, 'licenca', 4.60, '2017-03-15'),
(4, 2, 'DOC-AO-8841', 'Prof.ª Margarida Fontes', 'm.fontes@bandmed.ao', '+244 923 189 004', '006721094LA088', '5421190281', 'Ciências Exatas', 'Mestrado em Química Aplicada', 'Professora titular de Física e Química A.', 26, 'ativo', 4.90, '2021-01-10');

-- --------------------------------------------------------
-- 4. Tabela: classes (Turmas & Secções)
-- --------------------------------------------------------
CREATE TABLE `classes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(100) NOT NULL,
  `grade` VARCHAR(50) NOT NULL,
  `section` VARCHAR(10) NOT NULL,
  `cycle` VARCHAR(100) NOT NULL,
  `shift` ENUM('Manhã', 'Tarde', 'Integral') DEFAULT 'Manhã',
  `room` VARCHAR(50) NOT NULL,
  `student_count` INT UNSIGNED DEFAULT 0,
  `max_capacity` INT UNSIGNED DEFAULT 30,
  `head_teacher_id` BIGINT UNSIGNED DEFAULT NULL,
  `academic_year` VARCHAR(20) DEFAULT '2024/2025',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_classes_teacher` (`head_teacher_id`),
  CONSTRAINT `fk_classes_teacher` FOREIGN KEY (`head_teacher_id`) REFERENCES `teachers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `classes` (`id`, `code`, `name`, `grade`, `section`, `cycle`, `shift`, `room`, `student_count`, `max_capacity`, `head_teacher_id`, `academic_year`) VALUES
(1, 'turma-10a', '10º Ano - Turma A', '10º Ano', 'A', 'Ensino Secundário', 'Manhã', 'Sala B-104', 28, 30, 1, '2024/2025'),
(2, 'turma-10b', '10º Ano - Turma B', '10º Ano', 'B', 'Ensino Secundário', 'Manhã', 'Sala B-105', 26, 30, 4, '2024/2025'),
(3, 'turma-11a', '11º Ano - Turma A', '11º Ano', 'A', 'Ensino Secundário', 'Manhã', 'Sala C-201', 25, 30, 1, '2024/2025'),
(4, 'turma-11b', '11º Ano - Turma B (Saúde)', '11º Ano', 'B', 'Ensino Médio Técnico', 'Tarde', 'Sala C-202', 24, 28, 2, '2024/2025'),
(5, 'turma-12a', '12º Ano - Turma A (Pré-Médico)', '12º Ano', 'A', 'Ensino Médio Técnico', 'Manhã', 'Anfiteatro 1', 22, 25, 2, '2024/2025'),
(6, 'turma-7b', '7º Ano - Turma B', '7º Ano', 'B', '2º Ciclo do Básico', 'Tarde', 'Sala A-012', 30, 32, 1, '2024/2025');

-- --------------------------------------------------------
-- 5. Tabela: students (Alunos)
-- --------------------------------------------------------
CREATE TABLE `students` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED DEFAULT NULL,
  `class_id` BIGINT UNSIGNED NOT NULL,
  `proc_number` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL UNIQUE,
  `birth_date` DATE DEFAULT NULL,
  `nif` VARCHAR(50) DEFAULT NULL,
  `citizen_card` VARCHAR(50) DEFAULT NULL,
  `address` VARCHAR(255) DEFAULT NULL,
  `guardian_name` VARCHAR(191) NOT NULL,
  `guardian_phone` VARCHAR(50) NOT NULL,
  `guardian_email` VARCHAR(191) DEFAULT NULL,
  `guardian_nif` VARCHAR(50) DEFAULT NULL,
  `attendance_rate` DECIMAL(5,2) DEFAULT 100.00,
  `financial_status` ENUM('regular', 'debito', 'isento') DEFAULT 'regular',
  `status` ENUM('active', 'pending', 'transferred', 'suspended') DEFAULT 'active',
  `current_average` DECIMAL(4,2) DEFAULT 0.00,
  `unexcused_absences` INT UNSIGNED DEFAULT 0,
  `excused_absences` INT UNSIGNED DEFAULT 0,
  `monthly_tuition_kz` DECIMAL(12,2) DEFAULT 95000.00,
  `avatar` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_students_class` (`class_id`),
  KEY `fk_students_user` (`user_id`),
  CONSTRAINT `fk_students_class` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_students_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `students` (`id`, `user_id`, `class_id`, `proc_number`, `name`, `email`, `birth_date`, `nif`, `citizen_card`, `address`, `guardian_name`, `guardian_phone`, `guardian_email`, `guardian_nif`, `attendance_rate`, `financial_status`, `status`, `current_average`, `unexcused_absences`, `excused_absences`, `monthly_tuition_kz`, `avatar`) VALUES
(1, 3, 1, '2410', 'Tiago André Silva', 'tiago.silva@bandmed.edu.pt', '2008-03-14', '264891032', '15934812 4 ZX8', 'Av. das Forças Armadas, 42, 3º Dto, Luanda', 'Dr. Miguel Ferreira Silva', '+244 912 345 678', 'miguel.silva@arquitetura.ao', '241890112', 98.20, 'regular', 'active', 16.40, 0, 2, 95000.00, 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150'),
(2, NULL, 1, '2404', 'Maria Francisca Gomes', 'maria.gomes@bandmed.edu.pt', '2008-07-22', '251349104', '14820194 1 YX2', 'Rua Rainha Ginga, Edifício Sol, Luanda', 'Ana Luísa Gomes', '+244 933 881 229', 'ana.gomes@gestao.ao', '233118901', 99.10, 'regular', 'active', 17.20, 0, 1, 95000.00, 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150'),
(3, NULL, 1, '2389', 'Beatriz Santos Ramos', 'beatriz.ramos@bandmed.edu.pt', '2008-09-11', '272109834', '16049281 9 ZT4', 'Bairro Alvalade, Rua das Acácias, Luanda', 'Jorge Ramos', '+244 961 445 102', 'jorge.ramos@eng.ao', '245990123', 94.60, 'debito', 'active', 15.00, 3, 2, 95000.00, 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150'),
(4, NULL, 1, '2415', 'Tomás Afonso Matos', 'tomas.matos@bandmed.edu.pt', '2008-01-05', '280431992', '15839201 3 LK1', 'Condomínio Belas Business Park, Talatona', 'Carla Matos', '+244 928 903 551', 'carla.matos@adv.ao', '211445609', 96.00, 'regular', 'active', 14.80, 1, 2, 95000.00, 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150'),
(5, NULL, 1, '2422', 'Mariana Castro Ferreira', 'mariana.ferreira@bandmed.edu.pt', '2008-04-19', '263998120', '16110293 8 MN2', 'Miramar, Rua dos Navegantes, Luanda', 'Eng. Pedro Ferreira', '+244 917 220 981', 'pedro.ferreira@petro.ao', '202334890', 97.40, 'regular', 'active', 16.00, 1, 1, 95000.00, 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'),
(6, NULL, 1, 'BM-2023-8702', 'Carlos Eduardo Henriques', 'carlos.henriques@bandmed.edu.pt', '2008-02-15', '289441092', '15729103 2 KK3', 'Bairro Cruzeiro, Luanda', 'António Henriques', '+244 924 551 880', 'antonio.henriques@gmail.com', '219881334', 78.50, 'debito', 'pending', 9.80, 11, 1, 95000.00, 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150');

-- --------------------------------------------------------
-- 6. Tabela: subjects (Disciplinas Curriculares)
-- --------------------------------------------------------
CREATE TABLE `subjects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(100) NOT NULL,
  `cycle` VARCHAR(100) NOT NULL,
  `weekly_hours` INT UNSIGNED DEFAULT 4,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `subjects` (`id`, `code`, `name`, `cycle`, `weekly_hours`) VALUES
(1, 'MAT-A', 'Matemática A', 'Ensino Secundário', 5),
(2, 'FQ-A', 'Física e Química A', 'Ensino Secundário', 5),
(3, 'BG', 'Biologia e Geologia', 'Ensino Secundário', 4),
(4, 'PORT', 'Língua Portuguesa', 'Ensino Secundário', 4),
(5, 'ANAT', 'Anatomia e Fisiologia', 'Ensino Médio Técnico', 6),
(6, 'ING-T', 'Inglês Técnico', 'Ensino Secundário', 3);

-- --------------------------------------------------------
-- 7. Tabela: attendance_sheets (Cadernetas Diárias de Assiduidade)
-- --------------------------------------------------------
CREATE TABLE `attendance_sheets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `class_id` BIGINT UNSIGNED NOT NULL,
  `subject_id` BIGINT UNSIGNED NOT NULL,
  `teacher_id` BIGINT UNSIGNED NOT NULL,
  `date` DATE NOT NULL,
  `time_slot` VARCHAR(50) NOT NULL,
  `room` VARCHAR(50) NOT NULL,
  `status` ENUM('aberto', 'sincronizado', 'homologado') DEFAULT 'aberto',
  `lesson_summary` TEXT,
  `is_signed` TINYINT(1) DEFAULT 0,
  `signed_by` VARCHAR(191) DEFAULT NULL,
  `signed_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_attendance_class` (`class_id`),
  KEY `fk_attendance_subject` (`subject_id`),
  KEY `fk_attendance_teacher` (`teacher_id`),
  CONSTRAINT `fk_attendance_class` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_attendance_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_attendance_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `attendance_sheets` (`id`, `class_id`, `subject_id`, `teacher_id`, `date`, `time_slot`, `room`, `status`, `lesson_summary`, `is_signed`, `signed_by`, `signed_at`) VALUES
(1, 1, 1, 1, '2024-10-24', '08:30–10:00', 'Sala B-104', 'sincronizado', 'Introdução ao estudo das funções trigonométricas (círculo trigonométrico e radianos). Resolução de exercícios.', 1, 'Prof. João Figueiredo', '2024-10-24 09:45:00');

-- --------------------------------------------------------
-- 8. Tabela: attendance_records (Marcação Individual de Presenças)
-- --------------------------------------------------------
CREATE TABLE `attendance_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sheet_id` BIGINT UNSIGNED NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('P', 'FJ', 'FI', 'A') DEFAULT 'P',
  `entry_time` VARCHAR(10) DEFAULT NULL,
  `note` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_attrec_sheet` (`sheet_id`),
  KEY `fk_attrec_student` (`student_id`),
  CONSTRAINT `fk_attrec_sheet` FOREIGN KEY (`sheet_id`) REFERENCES `attendance_sheets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_attrec_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `attendance_records` (`id`, `sheet_id`, `student_id`, `status`, `entry_time`, `note`) VALUES
(1, 1, 1, 'P', '08:30', 'Presente na aula'),
(2, 1, 2, 'P', '08:30', 'Participativa'),
(3, 1, 3, 'FJ', NULL, 'Atestado médico entregue na secretaria'),
(4, 1, 4, 'A', '08:42', 'Atraso justificado pelo trânsito na linha amarela'),
(5, 1, 5, 'P', '08:30', 'Presente'),
(6, 1, 6, 'FI', 'FALTOU', 'Sem justificação. Encarregado alertado.');

-- --------------------------------------------------------
-- 9. Tabela: exams (Exames e Pautas de Avaliação)
-- --------------------------------------------------------
CREATE TABLE `exams` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reference_code` VARCHAR(50) NOT NULL UNIQUE,
  `class_id` BIGINT UNSIGNED NOT NULL,
  `subject_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `trimester` ENUM('1', '2', '3') DEFAULT '1',
  `academic_year` VARCHAR(20) DEFAULT '2024/2025',
  `teacher_name` VARCHAR(191) NOT NULL,
  `status` ENUM('em_lancamento', 'aguardando_assinatura', 'homologada') DEFAULT 'em_lancamento',
  `class_average` DECIMAL(4,2) DEFAULT 0.00,
  `is_director_signed` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_exams_class` (`class_id`),
  KEY `fk_exams_subject` (`subject_id`),
  CONSTRAINT `fk_exams_class` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_exams_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `exams` (`id`, `reference_code`, `class_id`, `subject_id`, `title`, `trimester`, `academic_year`, `teacher_name`, `status`, `class_average`, `is_director_signed`) VALUES
(1, 'PT-2024-FQ10A-S1', 1, 2, 'Teste Sumativo 1 + Laboratório', '1', '2024/2025', 'Prof.ª Margarida Fontes', 'aguardando_assinatura', 14.20, 0);

-- --------------------------------------------------------
-- 10. Tabela: grade_records (Lançamento de Notas / Pautas)
-- --------------------------------------------------------
CREATE TABLE `grade_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `exam_id` BIGINT UNSIGNED NOT NULL,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `mac` DECIMAL(4,2) DEFAULT 0.00,
  `npp` DECIMAL(4,2) DEFAULT 0.00,
  `npt` DECIMAL(4,2) DEFAULT 0.00,
  `final_score` DECIMAL(4,2) DEFAULT 0.00,
  `qualitative` VARCHAR(50) DEFAULT NULL,
  `situation` VARCHAR(50) DEFAULT NULL,
  `teacher_note` TEXT,
  PRIMARY KEY (`id`),
  KEY `fk_grades_exam` (`exam_id`),
  KEY `fk_grades_student` (`student_id`),
  CONSTRAINT `fk_grades_exam` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_grades_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `grade_records` (`id`, `exam_id`, `student_id`, `mac`, `npp`, `npt`, `final_score`, `qualitative`, `situation`, `teacher_note`) VALUES
(1, 1, 1, 19.40, 19.00, 18.50, 19.10, 'Excelente', 'Transita (Dispensa)', 'Excelente domínio concetual e rigor experimental.'),
(2, 1, 2, 14.80, 15.20, 16.00, 15.40, 'Bom', 'Transita (Dispensa)', 'Participativa nos debates práticos.'),
(3, 1, 3, 14.50, 15.00, 15.50, 15.00, 'Bom', 'Transita (Dispensa)', 'Bom aproveitamento.'),
(4, 1, 4, 10.20, 11.50, 13.00, 11.70, 'Suficiente', 'Transita', 'Progresso visível no laboratório.'),
(5, 1, 5, 16.50, 17.00, 17.50, 17.10, 'Muito Bom', 'Transita (Dispensa)', 'Autonomia exemplar em ensaios práticos.'),
(6, 1, 6, 7.20, 8.50, 8.00, 7.90, 'Insuficiente', 'Exame de Recurso', 'Dificuldade na interpretação; necessita apoio.');

-- --------------------------------------------------------
-- 11. Tabela: tuition_fees (Propinas & Pagamentos em Kwanzas Kz)
-- --------------------------------------------------------
CREATE TABLE `tuition_fees` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `invoice_number` VARCHAR(50) NOT NULL UNIQUE,
  `receipt_number` VARCHAR(50) DEFAULT NULL,
  `period` VARCHAR(50) NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `base_amount_kz` DECIMAL(12,2) NOT NULL,
  `late_fee_kz` DECIMAL(12,2) DEFAULT 0.00,
  `total_amount_kz` DECIMAL(12,2) NOT NULL,
  `due_date` DATE NOT NULL,
  `payment_date` DATETIME DEFAULT NULL,
  `status` ENUM('pago', 'atraso', 'pendente', 'isento') DEFAULT 'pendente',
  `method` ENUM('mcx', 'multicaixa', 'debito', 'numerario', 'tpa') DEFAULT NULL,
  `multicaixa_entity` VARCHAR(20) DEFAULT '00192',
  `multicaixa_ref` VARCHAR(50) DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_tuition_student` (`student_id`),
  CONSTRAINT `fk_tuition_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `tuition_fees` (`id`, `student_id`, `invoice_number`, `receipt_number`, `period`, `description`, `base_amount_kz`, `late_fee_kz`, `total_amount_kz`, `due_date`, `payment_date`, `status`, `method`, `multicaixa_entity`, `multicaixa_ref`) VALUES
(1, 1, 'FT 2024/1892', 'RC 2024/1420', 'Novembro 2024', 'Propina Novembro + Seguro Escolar', 245000.00, 0.00, 245000.00, '2024-11-08', '2024-11-06 14:22:00', 'pago', 'mcx', '00192', '891 002 918'),
(2, 2, 'FT 2024/1850', NULL, 'Novembro 2024', 'Propina Mensal - Novembro 2024', 285000.00, 12500.00, 297500.00, '2024-11-08', NULL, 'atraso', NULL, '00192', '891 003 440'),
(3, 4, 'FT 2024/2004', NULL, 'Novembro 2024', 'Propina Mensal + Cantina Escolar', 310000.00, 0.00, 310000.00, '2024-11-28', NULL, 'pendente', 'multicaixa', '00192', '890 123 441'),
(4, 5, 'FT 2024/1711', 'RC 2024/1399', 'Novembro 2024', 'Propina Mensal (Desconto Irmão 10%)', 225000.00, 0.00, 225000.00, '2024-11-05', '2024-11-05 08:00:00', 'pago', 'debito', '00192', NULL),
(5, 6, 'FT 2024/1822', NULL, 'Novembro 2024', 'Propina Mensal + Rota Transporte Bus', 330000.00, 18200.00, 348200.00, '2024-11-08', NULL, 'atraso', NULL, '00192', '891 004 881');

-- --------------------------------------------------------
-- 12. Tabela: notices (Mural de Avisos)
-- --------------------------------------------------------
CREATE TABLE `notices` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(191) NOT NULL,
  `excerpt` VARCHAR(255) NOT NULL,
  `content` TEXT NOT NULL,
  `author` VARCHAR(100) NOT NULL,
  `author_role` VARCHAR(100) NOT NULL,
  `priority` ENUM('urgente', 'alta', 'normal', 'informativa') DEFAULT 'normal',
  `date` VARCHAR(50) NOT NULL,
  `reads_count` INT UNSIGNED DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `notices` (`id`, `title`, `excerpt`, `content`, `author`, `author_role`, `priority`, `date`, `reads_count`) VALUES
(1, 'Interrupção Letiva - Provas de Aferição', 'Pavilhão Gimnodesportivo e Salas B1-B8 interditadas.', 'Informamos que decorrerão as provas de aferição conforme o calendário oficial.', 'Direção Pedagógica', 'Diretor Geral', 'alta', 'Hoje, 09:15', 482),
(2, 'Submissão das Pautas de Frequência', 'Prazo no módulo de Exames & Notas até 15 de Dezembro.', 'Aviso aos docentes titulares de disciplina para validação e fecho das cadernetas.', 'Gabinete de Avaliação', 'Coordenação', 'urgente', 'Ontem, 16:40', 76);

-- --------------------------------------------------------
-- 13. Tabela: library_books (Biblioteca Escolar)
-- --------------------------------------------------------
CREATE TABLE `library_books` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(191) NOT NULL,
  `author` VARCHAR(191) NOT NULL,
  `isbn` VARCHAR(50) NOT NULL UNIQUE,
  `category` VARCHAR(100) NOT NULL,
  `total_copies` INT UNSIGNED DEFAULT 1,
  `available_copies` INT UNSIGNED DEFAULT 1,
  `shelf_location` VARCHAR(100) DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `library_books` (`id`, `title`, `author`, `isbn`, `category`, `total_copies`, `available_copies`, `shelf_location`) VALUES
(1, 'Química 10º Ano — Estrutura da Matéria e Soluções', 'Dra. Luísa Mendonça & Prof. Carlos Silva', '978-989-10-2384-1', 'Ciências Exatas', 40, 28, 'Estante B4, Prateleira 2'),
(2, 'Matemática do Ensino Médio — Funções e Trigonometria', 'Prof. João Figueiredo', '978-989-22-9018-4', 'Matemática', 35, 14, 'Estante A1, Prateleira 3'),
(3, 'Manual de Anatomia Humana e Fisiologia Básica', 'Dr. Artur Cambuta', '978-989-80-4491-0', 'Saúde / Medicina', 20, 5, 'Estante C2, Prateleira 1');

-- --------------------------------------------------------
-- 14. Tabela: system_settings (Parâmetros Globais & Institucionais)
-- --------------------------------------------------------
CREATE TABLE `system_settings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `school_name` VARCHAR(191) NOT NULL,
  `nif` VARCHAR(50) NOT NULL,
  `decree_authorization` VARCHAR(191) NOT NULL,
  `province` VARCHAR(100) NOT NULL,
  `municipality` VARCHAR(100) NOT NULL,
  `address` VARCHAR(255) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `phone` VARCHAR(100) NOT NULL,
  `current_academic_year` VARCHAR(20) DEFAULT '2024/2025',
  `currency_code` VARCHAR(10) DEFAULT 'Kz',
  `current_trimester` ENUM('1', '2', '3') DEFAULT '1',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `system_settings` (`id`, `school_name`, `nif`, `decree_authorization`, `province`, `municipality`, `address`, `email`, `phone`, `current_academic_year`, `currency_code`, `current_trimester`) VALUES
(1, 'BandMed - Complexo Escolar Privado', '5412890321', 'Decreto Executivo n.º 412/18 - Gabinete Provincial de Luanda', 'Luanda', 'Talatona (Via Expressa, Km 14)', 'Via Expressa, Km 14, Talatona, Luanda, Angola', 'administracao@bandmed.co.ao', '+244 222 780 145 / +244 923 110 490', '2024/2025', 'Kz', '1');

SET FOREIGN_KEY_CHECKS = 1;

-- ==========================================================
-- Fim do Ficheiro SQL Autónomo de Gestão Escolar
-- ==========================================================
