import { database, ref, push, onValue, remove } from "./firebase-config.js";

let services = [];
let clients = [];
let employees = [];
let salonHoursConfig = null;
let salonBreakConfig = null;

const DAYS_MAP = { 'dimanche': 0, 'lundi': 1, 'mardi': 2, 'mercredi': 3, 'jeudi': 4, 'vendredi': 5, 'samedi': 6 };
let selectedTimeSlotMinutes = null;
let currentActiveReservationId = null;

// Écoute en temps réel de la configuration globale du salon
onValue(ref(database, 'salon_config'), (snapshot) => {
    const data = snapshot.val();

    salonHoursConfig = data?.hours || null;
    salonBreakConfig = data?.break || null;

    const daysHint = document.getElementById('salon-days-hint');

    if (daysHint) {
        daysHint.innerText =
            `Horaires : ${salonHoursConfig || "Non configuré"} | Pause & fermetures : ${salonBreakConfig || "Non configuré"}`;
    }

    loadAvailableTimeSlots();
});

// Écoute en temps réel des services
onValue(ref(database, 'services'), (snapshot) => {
    const data = snapshot.val();
    services = [];
    if (data) {
        Object.keys(data).forEach(key => {
            services.push({ id: key, ...data[key] });
        });
    }
    initClientPage();
});

// Écoute en temps réel des clients
onValue(ref(database, 'clients'), (snapshot) => {
    const data = snapshot.val();
    clients = [];
    if (data) {
        Object.keys(data).forEach(key => {
            clients.push({ id: key, ...data[key] });
        });
    }
    loadAvailableTimeSlots();
});


onValue(ref(database, 'employees'), (snapshot) => {
    const data = snapshot.val();
    employees = [];

    if (data) {
        Object.keys(data).forEach(key => {
            employees.push({
                id: key,
                ...data[key]
            });
        });
    }

    loadAvailableTimeSlots(); // ✅ OBLIGATOIRE
});

function hhmmToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h * 60) + m;
}

function minutesToHHMM(totalMinutes) {
    let hours = Math.floor(totalMinutes / 60);
    let minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getSalonLimits() {
    const defaultOpen = 9 * 60;
    const defaultClose = 19 * 60;

    if (!salonHoursConfig) {
        return { open: defaultOpen, close: defaultClose };
    }

    const matches = salonHoursConfig.match(/\d{2}:\d{2}/g);

    if (!matches || matches.length < 2) {
        return { open: defaultOpen, close: defaultClose };
    }

    return {
        open: hhmmToMinutes(matches[0]),
        close: hhmmToMinutes(matches[1])
    };
}

function getPauseAndClosureLimits() {
    const defaultPauseStart = 12 * 60 + 30;
    const defaultPauseEnd = 13 * 60 + 30;
    
    if (!salonBreakConfig) {
        return {
            start: defaultPauseStart,
            end: defaultPauseEnd,
            closedDays: [0]
        };
    }
    
    const textLower = salonBreakConfig.toLowerCase();
    
    const matches = textLower.match(/\d{2}:\d{2}/g);
    
    let pauseStart = defaultPauseStart;
    let pauseEnd = defaultPauseEnd;
    
    if (matches && matches.length >= 2) {
        pauseStart = hhmmToMinutes(matches[0]);
        pauseEnd = hhmmToMinutes(matches[1]);
    }
    
    const closedDays = [];
    
    for (const [dayName, dayIndex] of Object.entries(DAYS_MAP)) {
        if (textLower.includes(dayName)) {
            closedDays.push(dayIndex);
        }
    }
    
    return {
        start: pauseStart,
        end: pauseEnd,
        closedDays: closedDays.length ? closedDays : [0]
    };
}

function cancelBookingById(id) {

    const confirmation = confirm(
        "tena ho anjanona ilay reservation anao ve ?"
    );

    if (!confirmation) return;

    remove(ref(database, `clients/${id}`))
    .then(() => {

        alert(
          "nanjanona ilay resérvarion anao.\n\n Tsapanay fa mety misy tranga tsy ampoizina, de mirary soa ho anao, izahay dia misokatra eto foana ka asaina ianao ho tonga amin'ny fotoana izay mampalalaka  anao SALON DE BEAUTÉ MADAGASCAR😊😊 "
        );

        searchMyBookings();

    })
    .catch(error => {
        console.error(error);
        alert("Erreur lors de l'annulation.");
    });
}








function initClientPage() {
    const select = document.getElementById('select-service');
    const dateInput = document.getElementById('appointment-date');
    const scheduleSection = document.getElementById('schedule-section');
    const bookingForm = document.getElementById('booking-form-section');
    
    if (!select) return;
    select.innerHTML = '';
    
    if (services.length === 0) {
        select.innerHTML = '<option value="">-- Aucun service disponible --</option>';
        if (scheduleSection) scheduleSection.style.display = 'none';
        if (bookingForm) bookingForm.classList.add('hidden');
        return;
    }

    if (scheduleSection) scheduleSection.style.display = 'block';

    services.forEach(s => {
        select.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });

    if (dateInput && !dateInput.value) {
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        dateInput.min = `${y}-${m}-${d}`; 
        dateInput.value = `${y}-${m}-${d}`;
    }

    if (services.length === 1) {
        select.selectedIndex = 0;
    }
    updateServiceSelection();
}

function updateServiceSelection() {
    const select = document.getElementById('select-service');
    const headline = document.getElementById('table-headline');
    if (select && select.value) {
        const service = services.find(s => s.id == select.value);
        if (service && headline) {
            headline.innerText = `Service: ${service.name} (Durée : ${service.duration} min)`;
        }
    }
    loadAvailableTimeSlots();
}

window.updateServiceSelection = updateServiceSelection;
window.loadAvailableTimeSlots = loadAvailableTimeSlots;


function loadAvailableTimeSlots() {
    const tableBody = document.getElementById('available-slots-table-body');
    const tableWrapper = document.getElementById('table-wrapper');
    const msg = document.getElementById('slots-loading-message');
    const select = document.getElementById('select-service');
    const dateInput = document.getElementById('appointment-date');
    const bookingForm = document.getElementById('booking-form-section');

    if (!tableBody || !tableWrapper || !msg || !select || !dateInput) return;

    // 1. Famafana sy famerenana ny fampisehoana ho amin'ny teboka zero
    tableBody.innerHTML = '';
    tableWrapper.style.display = 'none';
    if (bookingForm) bookingForm.classList.add('hidden');
    
    if (typeof selectedTimeSlotMinutes !== 'undefined') {
        selectedTimeSlotMinutes = null;
    }

    // 2. Fanamarinana ny safidy nataon'ny mpanjifa
    if (!select.value || !dateInput.value) {
        msg.innerText = "Misafidiana asa sy daty  azafady.";
        msg.style.display = 'block';
        return;
    }

    if (typeof services === 'undefined') return;
    const service = services.find(s => s.id == select.value);
    if (!service) return;

    // 3. Fitantanana ny daty sy ny fahasamihafan'ny ora (Fuseau horaire)
    const [year, month, day] = dateInput.value.split('-').map(Number);
    const targetDate = new Date(year, month - 1, day); 

    const pauseLimits = getPauseAndClosureLimits();
    if (pauseLimits && pauseLimits.closedDays && pauseLimits.closedDays.includes(targetDate.getDay())) {
        msg.textContent = "Miala tsiny tompoko fa mikatona izahay androany.";
        msg.style.display = 'block';
        return;
    }

    const salonLimits = getSalonLimits();
    if (!salonLimits) return;

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const currentMinutes = (now.getHours() * 60) + now.getMinutes();
    const isToday = (dateInput.value === todayStr);

    let hasAnyAvailableSlot = false;
    const fragment = document.createDocumentFragment(); 

    // Famandrihana isaky ny 5 minitra mba tsy hisian'ny fotoana matiantoka
    const TIME_STEP = 5; 

    // 4. Loop lehibe hitadiavana ny fotoana malalaka rehetra
    for (
        let startMin = salonLimits.open;
        startMin <= salonLimits.close - service.duration;
        startMin += TIME_STEP
    ) {
        const endMin = startMin + service.duration;

        // Tsy mihoatra ny ora fikatonan'ny trano heva
        if (endMin > salonLimits.close) {
            continue;
        }

        // Fanamarinana hentitra ny ora fisakafoana (pause déjeuner)
        const overlapPause = (startMin < pauseLimits.end && endMin > pauseLimits.start);
        if (overlapPause) {
            continue;
        }

        // Fitadiavana ny mpiasa malalaka tsy tapaka
        let availableEmployees = [];
        let firstMinute = true;
        let slotAvailable = true;

        for (let minute = startMin; minute < endMin; minute++) {
            const freeEmployees = getAvailableEmployeesAtMinute(minute, dateInput.value, service.id);
            
            if (!freeEmployees || freeEmployees.length === 0) {
                slotAvailable = false;
                break;
            }

            if (firstMinute) {
                availableEmployees = [...freeEmployees];
                firstMinute = false;
            } else {
                // Tsy maintsy mpiasa iray ihany no manao ny asa hatramin'ny farany
                availableEmployees = availableEmployees.filter(emp => freeEmployees.includes(emp));
                if (availableEmployees.length === 0) {
                    slotAvailable = false;
                    break;
                }
            }
        }

        // Fanamarinana raha efa lasa ny ora (ho an'ny androany)
        const isPastSlot = isToday && startMin <= currentMinutes;

        // Ny fotoana malalaka sy mbola tsy lasa ihany no ampidirina ao amin'ny HTML
        if (slotAvailable && !isPastSlot) {
            hasAnyAvailableSlot = true;
            const row = document.createElement('tr');
            
            const startStr = typeof minutesToHHMM === 'function' ? minutesToHHMM(startMin) : `${Math.floor(startMin/60)}:${String(startMin%60).padStart(2,'0')}`;
            const endStr = typeof minutesToHHMM === 'function' ? minutesToHHMM(endMin) : `${Math.floor(endMin/60)}:${String(endMin%60).padStart(2,'0')}`;

            row.innerHTML = `
                <td class="time-range">${startStr} - ${endStr}</td>
                <td><span class="status-badge status-available">Mbola malalaka</span></td>
                <td class="action-cell"></td>
            `;

            const btn = document.createElement('button');
            btn.className = "btn btn-secondary btn-select-slot";
            btn.innerText = "Hisafidy ity ora ity";
            btn.dataset.start = startMin;

            btn.onclick = function(e) {
                e.preventDefault();
                tableBody.querySelectorAll('tr').forEach(r => r.style.backgroundColor = '');
                
                row.style.backgroundColor = '#fff9e6';
                
                if (typeof selectedTimeSlotMinutes !== 'undefined') {
                    selectedTimeSlotMinutes = Number(this.dataset.start);
                }

                const hourInput = document.getElementById('client-selected-hour');
                if (hourInput) hourInput.value = startStr;

                if (bookingForm) {
                    bookingForm.classList.remove('hidden');
                    bookingForm.scrollIntoView({ behavior: 'smooth' });
                }
            };

            const staffInfo = document.createElement('span');
            staffInfo.className = "staff-count";
            staffInfo.innerText = ` (Toerana ${availableEmployees.length} malalaka)`;

            const actionCell = row.querySelector('.action-cell');
            if (actionCell) {
                actionCell.appendChild(btn);
                actionCell.appendChild(staffInfo);
            }
            
            fragment.appendChild(row);
        }
    }

    // 5. Fampidirana mitsitsy ny vokatra ao amin'ny DOM
    tableBody.appendChild(fragment);

    // Hafatra hita maso raha toa ka tsy misy ora malalaka intsony
    if (!hasAnyAvailableSlot) {
        msg.innerText = isToday 
            ? "Tsy misy ora malalaka intsony ho an'ny androany 😊 Misafidiana daty hafa azafady."
            : "Tsy misy ora malalaka amin'io daty io. Misafidiana daty hafa azafady.";
        msg.style.display = 'block';
        return;
    }

    msg.style.display = 'none';
    tableWrapper.style.display = 'block';
}


function isEmployeeAvailable(emp, dateISO, startMin, endMin) {
    return !clients.some(c =>
        c.employeeId === emp.id &&
        c.dateISO === dateISO &&
        startMin < c.endMin &&
        endMin > c.startMin
    );
}

function confirmClientBooking() {
    const select = document.getElementById('select-service');
    const dateInput = document.getElementById('appointment-date');
    const clientName = document.getElementById('client-name').value.trim();
    const phone = document.getElementById('client-phone').value.trim();

    if (!clientName || !phone) {
        alert("Veuillez saisir votre Nom complet et votre Numéro de téléphone afin de valider l'inscription.");
        return;
    }
    if (selectedTimeSlotMinutes === null) {
        alert("Veuillez choisir un horaire libre dans l'emploi du temps ci-dessus.");
        return;
    }

    const service = services.find(s => s.id == select.value);
let startMin = parseInt(selectedTimeSlotMinutes, 10);
const endMin = startMin + service.duration;
    const assignedEmployee = findAvailableEmployee(
    service.id,
    dateInput.value,
    startMin,
    endMin
);

if (!assignedEmployee) {
    alert("Aucun employé disponible pour ce créneau.");
    return;
}

    const [year, month, day] = dateInput.value.split('-');
    const formattedDate = `${day}/${month}/${year}`;
    const ticketNumber = "TK-" + Math.floor(100000 + Math.random() * 900000);

    push(ref(database, 'clients'), {
    clientName: clientName,
    clientPhone: phone,
    serviceName: service.name,
serviceId: service.id,
    duration: service.duration,

    startMin: startMin,
    endMin: endMin,

    timeStartStr: minutesToHHMM(startMin),
    timeEndStr: minutesToHHMM(endMin),

    dateISO: dateInput.value,
    dateFormatted: formattedDate,

    ticket: ticketNumber,

    employeeId: assignedEmployee.id,
    employeeName: assignedEmployee.name
})
.then(() => {
        alert("Félicitations ! voaray tsara ny réservation anao.");

        document.getElementById('ticket-content').innerHTML = `
            <strong>Numéro de ticket :</strong> ${ticketNumber}<br>
            <strong>anarana :</strong> ${clientName}<br>
            <strong>Téléphone :</strong> ${phone}<br>
            <hr style="border:1px dashed #e0e0e0; margin:10px 0;">
            <strong>service ho atao :</strong> ${service.name}<br>
            <strong>andro anaovana azy :</strong> ${formattedDate}<br>
            <strong>ora anaovana azy :</strong> de ${minutesToHHMM(startMin)} à ${minutesToHHMM(endMin)}
        `;

        const timeBeforeStr = minutesToHHMM(startMin - 5);
        document.getElementById('time-reminder-msg').innerText = `Attention : mba hampirindra tsara ny asa dia iangaviana ianao ho tonga 5 minitra mialohan'ny ora hanombohana ny asanao zany oe amin'ny ${timeBeforeStr}.`;

        document.getElementById('success-modal').classList.remove('hidden');

}).catch((error) => {
    alert("Erreur Firebase : " + error.message);
    console.error(error);
});
}


function confirmCancellation() {
    const answer = confirm(
        "Êtes-vous certain de vouloir annuler votre réservation ?\n\nVotre créneau sera immédiatement libéré pour un autre client."
    );

    if (answer) {
        triggerCancelProcess();
    }
}



function triggerCancelProcess() {

    if (!currentActiveReservationId) {
        alert("Aucune réservation trouvée.");
        return;
    }

    remove(ref(database, `clients/${currentActiveReservationId}`))
    .then(() => {

        document.getElementById('success-modal').classList.add('hidden');

        document.getElementById('cancel-reason-modal').classList.remove('hidden');

    })
    .catch(error => {
        console.error(error);
        alert("Une erreur est survenue lors de l'annulation.");
    });
}
function submitCancellationReason() {
    const reasonValue = document.getElementById('cancel-reason').value.trim();
    if(reasonValue) {
        push(ref(database, 'cancellations'), {
            date: new Date().toISOString(),
            reason: reasonValue
        });
    }
    document.getElementById('cancel-reason').value = '';
    document.getElementById('cancel-reason-modal').classList.add('hidden');
    clearFormFields();
}

function closeSuccessModal() {
    document.getElementById('success-modal').classList.add('hidden');
    clearFormFields();
}

function clearFormFields() {
    document.getElementById('client-name').value = '';
    document.getElementById('client-phone').value = '';
    document.getElementById('client-selected-hour').value = '';
    selectedTimeSlotMinutes = null;
    currentActiveReservationId = null;
}

window.confirmClientBooking = confirmClientBooking;
window.confirmCancellation = confirmCancellation;
window.triggerCancelProcess = triggerCancelProcess;
window.submitCancellationReason = submitCancellationReason;
window.closeSuccessModal = closeSuccessModal;
window.cancelBookingById = cancelBookingById;


function searchMyBookings() {
    const phone = document.getElementById('search-phone').value.trim();
    const container = document.getElementById('my-bookings-list');

    if (!phone) {
        alert("Entrez votre numéro.");
        return;
    }

    const myBookings = clients.filter(
        c => c.clientPhone === phone
    );

    if (myBookings.length === 0) {
        container.innerHTML =
            "<p class='no-data'>Aucune réservation trouvée.</p>";
        return;
    }

    let html = `
        <table class="schedule-table">
            <thead>

<tr>
    <th>Service</th>
    <th>Date</th>
    <th>Heure</th>
    <th>Ticket</th>
    <th>Action</th>
</tr>
            </thead>
            <tbody>
    `;

    myBookings.forEach(b => {
        html += `
           <tr>
    <td>${b.serviceName}</td>
    <td>${b.dateFormatted}</td>
    <td>${b.timeStartStr} - ${b.timeEndStr}</td>
    <td>${b.ticket || "-"}</td>
    <td>
        <button
            class="btn btn-danger"
            onclick="cancelBookingById('${b.id}')">
            Annuler
        </button>
    </td>
</tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

window.searchMyBookings = searchMyBookings;


document.addEventListener('DOMContentLoaded', () => {
    initClientPage();
});



function getAvailableEmployeesAtMinute(minute, dateTarget, serviceId) {

    const service = services.find(s => s.id === serviceId);

    if (!service) return [];

    const startMin = minute;
const endMin = startMin + service.duration;

    return employees.filter(emp => {

        const canDoService =
            emp.polyvalent ||
            (
                Array.isArray(emp.services) &&
                emp.services.includes(service.name)
            );

        if (!canDoService) return false;

        const hasConflict = clients.some(c =>
            c.employeeId === emp.id &&
            c.dateISO === dateTarget &&
            startMin < c.endMin &&
            endMin > c.startMin
        );

        return !hasConflict;
    });
}




function findAvailableEmployee(serviceId, dateISO, startMin, endMin) {

    const eligibleEmployees = employees.filter(emp =>
        emp.polyvalent ||
   (
    Array.isArray(emp.services) &&
    emp.services.includes(
        services.find(s => s.id === serviceId)?.name
    )
)
    );

    for (const emp of eligibleEmployees) {

        const busy = clients.some(c =>
            c.employeeId === emp.id &&
            c.dateISO === dateISO &&
            !(endMin <= c.startMin || startMin >= c.endMin)
        );

        if (!busy) {
            return emp;
        }
    }

    return null;
}

function generateDynamicSlots(serviceDuration, dateISO, salonOpen, salonClose, bookedSlots) {

    const slots = [];

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    let cursor = salonOpen;

    // 🔥 si aujourd’hui → départ = maintenant
    if (dateISO === todayStr) {
        cursor = Math.max(cursor, now.getHours() * 60 + now.getMinutes());
    }

    const sortedBookings = [...bookedSlots].sort((a, b) => a.startMin - b.startMin);

    while (cursor + serviceDuration <= salonClose) {

        const start = cursor;
        const end = start + serviceDuration;

        // ❌ collision avec réservations Firebase
        const conflict = sortedBookings.some(b =>
            !(end <= b.startMin || start >= b.endMin)
        );

        if (!conflict) {
            slots.push({ start, end });
            cursor = end; // 🔥 avance après slot validé
        } else {
            cursor += 5; // 🔥 recherche fine (5 min)
        }
    }

    return slots;
}
