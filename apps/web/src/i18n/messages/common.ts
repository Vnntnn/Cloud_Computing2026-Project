import { defineMessages } from "../defineMessages";

export const common = defineMessages(
  {
    nav: {
      explore: "สำรวจ",
      login: "เข้าสู่ระบบ",
      register: "สมัครสมาชิก",
    },
    userMenu: {
      label: "เมนูผู้ใช้",
      tickets: "ตั๋วของฉัน",
      profile: "โปรไฟล์",
      dashboard: "แดชบอร์ด",
      signOut: "ออกจากระบบ",
    },
    language: { label: "เปลี่ยนภาษา", th: "ไทย", en: "English" },
    theme: { label: "เปลี่ยนธีม", light: "สว่าง", dark: "มืด", system: "ตามระบบ" },
    free: "ฟรี",
    // the label that follows the pointer over an event cover
    cursor: { view: "ดู" },
    // browser tab titles that carry the event's name or need a word of their own ("| Eventide" is added by pageTitle())
    pageTitle: {
      ticket: "ตั๋ว · {event}",
      order: "รายการสั่งซื้อ · {event}",
      register: "ลงทะเบียน · {event}",
      newTicketType: "เพิ่มประเภทตั๋ว",
      editTicketType: "แก้ไขประเภทตั๋ว",
    },
    close: "ปิด",
    loading: "กำลังโหลด",
    closeToast: "ปิดการแจ้งเตือน",
    sidebar: {
      title: "เมนูข้าง",
      description: "เมนูข้างสำหรับหน้าจอมือถือ",
      toggle: "สลับเมนูข้าง",
    },
    duration: {
      day: "{n} วัน",
      hour: "{n} ชั่วโมง",
      minute: "{n} นาที",
    },
  },
  {
    nav: {
      explore: "Explore",
      login: "Sign in",
      register: "Sign up",
    },
    userMenu: {
      label: "User menu",
      tickets: "My tickets",
      profile: "Profile",
      dashboard: "Dashboard",
      signOut: "Sign out",
    },
    language: { label: "Change language", th: "ไทย", en: "English" },
    theme: { label: "Change theme", light: "Light", dark: "Dark", system: "System" },
    free: "Free",
    cursor: { view: "View" },
    pageTitle: {
      ticket: "Ticket · {event}",
      order: "Order · {event}",
      register: "Register · {event}",
      newTicketType: "Add ticket type",
      editTicketType: "Edit ticket type",
    },
    close: "Close",
    loading: "Loading",
    closeToast: "Dismiss notification",
    sidebar: {
      title: "Sidebar",
      description: "The sidebar menu for mobile screens.",
      toggle: "Toggle sidebar",
    },
    duration: {
      day: ({ n }) => (n === 1 ? "1 day" : `${n} days`),
      hour: ({ n }) => (n === 1 ? "1 hour" : `${n} hours`),
      minute: ({ n }) => (n === 1 ? "1 minute" : `${n} minutes`),
    },
  },
);
