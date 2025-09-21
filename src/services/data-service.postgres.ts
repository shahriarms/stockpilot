
'use server';

import { Pool } from 'pg';
import type { Product, Invoice, Buyer, Expense, Employee, SalaryPayment, Payment, Attendance, AttendanceStatus, InvoiceItem } from '@/lib/types';
import PostgresProductService from './product-service.postgres';

// This is a Server Action file. It will only run on the server.
const usePostgres = !!process.env.POSTGRES_URL;

const pool = usePostgres ? new Pool({ connectionString: process.env.POSTGRES_URL }) : null;


export interface BackupData {
    products: Product[];
    invoices: Invoice[];
    buyers: Buyer[];
    expenses: Expense[];
    employees: Employee[];
    salaryPayments: SalaryPayment[];
    payments: Payment[];
    attendance: Attendance[];
}

// Helper function to format row data from snake_case to camelCase if needed, and parse JSON
function formatRow(row: any) {
    if (!row) return row;
    const newRow: { [key: string]: any } = {};
    for (const key in row) {
        // This simple camelCase conversion might need adjustment for complex names
        const camelKey = key.replace(/_([a-z])/g, g => g[1].toUpperCase());
        
        // Safely parse JSON fields
        if ((camelKey === 'items' || camelKey === 'invoiceIds') && typeof row[key] === 'string') {
             try {
                newRow[camelKey] = JSON.parse(row[key]);
            } catch (e) {
                newRow[camelKey] = row[key]; // Keep as string if parsing fails
            }
        } else {
             newRow[camelKey] = row[key];
        }

        // Convert numeric strings to numbers
        if (camelKey === 'subtotal' || camelKey === 'paidAmount' || camelKey === 'dueAmount' || camelKey === 'amount' || camelKey === 'salary') {
            newRow[camelKey] = parseFloat(row[key]);
        }
    }
    return newRow;
}


class PostgresDataService {

    static async getAllData() {
        if (!pool) throw new Error("Database not connected.");
        const invoices = (await pool.query('SELECT * FROM invoices ORDER BY id DESC')).rows.map(formatRow) as Invoice[];
        const buyers = (await pool.query('SELECT * FROM buyers ORDER BY name ASC')).rows.map(formatRow) as Buyer[];
        const expenses = (await pool.query('SELECT * FROM expenses ORDER BY date DESC')).rows.map(formatRow) as Expense[];
        const employees = (await pool.query('SELECT * FROM employees ORDER BY name ASC')).rows.map(formatRow) as Employee[];
        const salaryPayments = (await pool.query('SELECT * FROM salary_payments ORDER BY date DESC')).rows.map(formatRow) as SalaryPayment[];
        const payments = (await pool.query('SELECT * FROM payments ORDER BY date DESC')).rows.map(formatRow) as Payment[];
        const attendance = (await pool.query('SELECT * FROM attendance ORDER BY date DESC')).rows.map(formatRow) as Attendance[];

        return { invoices, buyers, expenses, employees, salaryPayments, payments, attendance };
    }

    static async getAllProducts(): Promise<Product[]> {
        return PostgresProductService.getAllProducts();
    }
    
    static async addInvoice(invoiceData: Omit<Invoice, 'id'>, items: any[]): Promise<Invoice> {
        if (!pool) throw new Error("Database not connected.");
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // Get the last invoice ID and increment it
            const lastIdResult = await client.query('SELECT id FROM invoices ORDER BY id DESC LIMIT 1');
            const newId = lastIdResult.rows.length > 0 ? lastIdResult.rows[0].id + 1 : 1;
            
            const newInvoice = { ...invoiceData, id: newId };

            // Upsert buyer and get their ID
            let buyerId = invoiceData.buyerId;
            if (invoiceData.customerName) {
                let buyerResult = await client.query('SELECT id FROM buyers WHERE name = $1 AND phone = $2', [invoiceData.customerName, invoiceData.customerPhone]);
                if (buyerResult.rows.length > 0) {
                    buyerId = buyerResult.rows[0].id;
                     await client.query(
                        'UPDATE buyers SET invoice_ids = invoice_ids || $1::jsonb WHERE id = $2',
                        [JSON.stringify(newId), buyerId]
                    );
                } else {
                    buyerId = `buyer-${Date.now()}`;
                    await client.query(
                        'INSERT INTO buyers (id, name, address, phone, invoice_ids) VALUES ($1, $2, $3, $4, $5)',
                        [buyerId, invoiceData.customerName, invoiceData.customerAddress, invoiceData.customerPhone, JSON.stringify([newId])]
                    );
                }
                newInvoice.buyerId = buyerId;
            }

            // Insert invoice
            await client.query(
                'INSERT INTO invoices (id, buyer_id, customer_name, customer_address, customer_phone, items, subtotal, paid_amount, due_amount, date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                [newInvoice.id, newInvoice.buyerId, newInvoice.customerName, newInvoice.customerAddress, newInvoice.customerPhone, JSON.stringify(items), newInvoice.subtotal, newInvoice.paidAmount, newInvoice.dueAmount, newInvoice.date]
            );

            // Update product stock
            const stockUpdates = items.map(item => ({
                id: item.id,
                stockChange: -item.quantity,
            }));
            await PostgresProductService.updateMultipleStocks(stockUpdates, client);
            
            await client.query('COMMIT');
            return formatRow(newInvoice) as Invoice;

        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }
    
    static async deleteInvoice(invoiceId: number): Promise<void> {
        if (!pool) throw new Error("Database not connected.");
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const invoiceResult = await client.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
            if (invoiceResult.rows.length === 0) throw new Error('Invoice not found.');
            const invoice: Invoice = formatRow(invoiceResult.rows[0]);

            if (invoice.items && invoice.items.length > 0) {
                const stockUpdates = invoice.items.map(item => ({ id: item.id, stockChange: +item.quantity }));
                await PostgresProductService.updateMultipleStocks(stockUpdates, client);
            }

            await client.query('DELETE FROM payments WHERE invoice_id = $1', [invoiceId]);
            
            if (invoice.buyerId) {
                await client.query(
                    "UPDATE buyers SET invoice_ids = invoice_ids - $1::text WHERE id = $2",
                    [String(invoiceId), invoice.buyerId]
                );
            }

            await client.query('DELETE FROM invoices WHERE id = $1', [invoiceId]);

            // Check if the buyer has any other invoices left
            if (invoice.buyerId) {
                const buyerInvoicesResult = await client.query("SELECT invoice_ids FROM buyers WHERE id = $1", [invoice.buyerId]);
                const remainingInvoiceIds = buyerInvoicesResult.rows[0]?.invoice_ids || [];
                if (remainingInvoiceIds.length === 0) {
                    await client.query("DELETE FROM buyers WHERE id = $1", [invoice.buyerId]);
                }
            }

            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    static async addExpense(expenseData: Omit<Expense, 'id'>): Promise<Expense> {
        if (!pool) throw new Error("Database not connected.");
        const newId = `exp-${Date.now()}`;
        const newExpense = { ...expenseData, id: newId };
        await pool.query(
            'INSERT INTO expenses (id, main_category, name, description, amount, date) VALUES ($1, $2, $3, $4, $5, $6)',
            [newExpense.id, newExpense.mainCategory, newExpense.name, newExpense.description, newExpense.amount, newExpense.date]
        );
        return formatRow(newExpense) as Expense;
    }

    static async updateExpense(expenseId: string, updatedData: Omit<Expense, 'id'>): Promise<Expense | null> {
        if (!pool) throw new Error("Database not connected.");
        const { mainCategory, name, description, amount, date } = updatedData;
        const result = await pool.query(
            'UPDATE expenses SET main_category = $1, name = $2, description = $3, amount = $4, date = $5 WHERE id = $6 RETURNING *',
            [mainCategory, name, description, amount, date, expenseId]
        );
        return formatRow(result.rows[0]) as Expense;
    }

    static async deleteExpense(expenseId: string): Promise<void> {
        if (!pool) throw new Error("Database not connected.");
        await pool.query('DELETE FROM expenses WHERE id = $1', [expenseId]);
    }

     static async addEmployee(employeeData: Omit<Employee, 'id'>): Promise<Employee> {
        if (!pool) throw new Error("Database not connected.");
        const newId = `emp-${Date.now()}`;
        const newEmployee = { ...employeeData, id: newId };
        await pool.query(
            'INSERT INTO employees (id, name, phone, address, role, salary, joining_date) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [newId, newEmployee.name, newEmployee.phone, newEmployee.address, newEmployee.role, newEmployee.salary, newEmployee.joiningDate]
        );
        return formatRow(newEmployee) as Employee;
    }

    static async updateEmployee(employeeId: string, updatedData: Omit<Employee, 'id'>): Promise<Employee | null> {
        if (!pool) throw new Error("Database not connected.");
        const { name, phone, address, role, salary, joiningDate } = updatedData;
        const result = await pool.query(
            'UPDATE employees SET name = $1, phone = $2, address = $3, role = $4, salary = $5, joining_date = $6 WHERE id = $7 RETURNING *',
            [name, phone, address, role, salary, joiningDate, employeeId]
        );
        return formatRow(result.rows[0]) as Employee;
    }

    static async deleteEmployee(employeeId: string): Promise<void> {
        if (!pool) throw new Error("Database not connected.");
        await pool.query('DELETE FROM employees WHERE id = $1', [employeeId]);
    }
    
    static async addSalaryPayment(paymentData: Omit<SalaryPayment, 'id'>): Promise<SalaryPayment> {
        if (!pool) throw new Error("Database not connected.");
        const newId = `sal-${Date.now()}`;
        const newPayment = { ...paymentData, id: newId };
        await pool.query(
            'INSERT INTO salary_payments (id, employee_id, amount, date, paid_by) VALUES ($1, $2, $3, $4, $5)',
            [newId, newPayment.employeeId, newPayment.amount, newPayment.date, newPayment.paidBy]
        );
        return formatRow(newPayment) as SalaryPayment;
    }

    static async addPayment(paymentData: Omit<Payment, 'id' | 'date'>): Promise<{ payment: Payment, updatedInvoice: Invoice }> {
        if (!pool) throw new Error("Database not connected.");
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const newId = `pay-${Date.now()}`;
            const newPayment = { ...paymentData, id: newId, date: new Date().toISOString() };
            
            await client.query(
                'INSERT INTO payments (id, invoice_id, buyer_id, amount, date) VALUES ($1, $2, $3, $4, $5)',
                [newId, newPayment.invoiceId, newPayment.buyerId, newPayment.amount, newPayment.date]
            );

            const updatedInvoiceResult = await client.query(
                'UPDATE invoices SET paid_amount = paid_amount + $1, due_amount = due_amount - $1 WHERE id = $2 RETURNING *',
                [newPayment.amount, newPayment.invoiceId]
            );

            await client.query('COMMIT');
            return {
                payment: formatRow(newPayment) as Payment,
                updatedInvoice: formatRow(updatedInvoiceResult.rows[0]) as Invoice,
            };

        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    static async markAttendance(attendanceData: Omit<Attendance, 'id'>): Promise<Attendance> {
        if (!pool) throw new Error("Database not connected.");
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { employeeId, date, status } = attendanceData;
            
            const dateString = new Date(date).toISOString().split('T')[0];

            const existingResult = await client.query(
                "SELECT id FROM attendance WHERE employee_id = $1 AND date_trunc('day', date) = date_trunc('day', $2::date)",
                [employeeId, dateString]
            );

            let result;
            if (existingResult.rows.length > 0) {
                // Update
                const existingId = existingResult.rows[0].id;
                result = await client.query(
                    'UPDATE attendance SET status = $1 WHERE id = $2 RETURNING *',
                    [status, existingId]
                );
            } else {
                // Insert
                const newId = `att-${Date.now()}`;
                result = await client.query(
                    'INSERT INTO attendance (id, employee_id, date, status) VALUES ($1, $2, $3, $4) RETURNING *',
                    [newId, employeeId, date, status]
                );
            }
            await client.query('COMMIT');
            return formatRow(result.rows[0]) as Attendance;

        } catch(e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }
}

export default PostgresDataService;
