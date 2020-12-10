    //calendar

    const displayWeeklyCalendar = document.createElement("div");
    displayWeeklyCalendar.classList.add("calendar");
    mainElement.appendChild(displayWeeklyCalendar);


    const daySunday = document.createElement("div");
    daySunday.classList.add("day");
    daySunday.setAttribute("id", "Sunday");
    daySunday.innerText = "Sunday";
    const howManySundayTasks = document.createElement("p");
    howManySundayTasks.classList.add("how-many-tasks-on-day");
    // howManyTasks.innerText = "You have " + user.tasks.day.count + " on " + day;
    howManySundayTasks.innerText = "You have 5 tasks on Sunday";
    const clickHereSunday = document.createElement("p");
    clickHereSunday.classList.add("click-here-message");
    clickHereSunday.innerText = "Click here to see Sunday's tasks.";
    displayWeeklyCalendar.appendChild(daySunday);
    daySunday.appendChild(howManySundayTasks);
    daySunday.appendChild(clickHereSunday);

    const dayMonday = document.createElement("div");
    dayMonday.classList.add("day");
    dayMonday.setAttribute("id", "Monday");
    dayMonday.innerText = "Monday";
    const howManyMondayTasks = document.createElement("p");
    howManyMondayTasks.classList.add("how-many-tasks-on-day");
    // howManyTasks.innerText = "You have " + user.tasks.day.count + " on " + day;
    howManyMondayTasks.innerText = "You have 5 tasks on Monday";
    const clickHereMonday = document.createElement("p");
    clickHereMonday.classList.add("click-here-message");
    clickHereMonday.innerText = "Click here to see Monday's tasks.";
    displayWeeklyCalendar.appendChild(dayMonday);
    dayMonday.appendChild(howManyMondayTasks);
    dayMonday.appendChild(clickHereMonday);

    const dayTuesday = document.createElement("div");
    dayTuesday.classList.add("day");
    dayTuesday.setAttribute("id", "Tuesday");
    dayTuesday.innerText = "Tuesday";
    const howManyTuesdayTasks = document.createElement("p");
    howManyTuesdayTasks.classList.add("how-many-tasks-on-day");
    // howManyTasks.innerText = "You have " + user.tasks.day.count + " on " + day;
    howManyTuesdayTasks.innerText = "You have 5 tasks on Tuesday";
    const clickHereTuesday = document.createElement("p");
    clickHereTuesday.classList.add("click-here-message");
    clickHereTuesday.innerText = "Click here to see Tuesday's tasks.";
    displayWeeklyCalendar.appendChild(dayTuesday);
    dayTuesday.appendChild(howManyTuesdayTasks);
    dayTuesday.appendChild(clickHereTuesday);

    const dayWednesday = document.createElement("div");
    dayWednesday.classList.add("day");
    dayWednesday.setAttribute("id", "Wednesday");
    dayWednesday.innerText = " Wednesday";
    const howManyWednesdayTask = document.createElement("p");
    howManyWednesdayTask.classList.add("how-many-tasks-on-day");
    // howManyTasks.innerText = "You have " + user.tasks.day.count + " on " + day;
    howManyWednesdayTask.innerText = "You have 5 tasks on  Wednesday";
    const clickHereWednesday = document.createElement("p");
    clickHereWednesday.classList.add("click-here-message");
    clickHereWednesday.innerText = "Click here to see Wednesday's tasks.";
    displayWeeklyCalendar.appendChild(dayWednesday);
    dayWednesday.appendChild(howManyWednesdayTask);
    dayWednesday.appendChild(clickHereWednesday);

    const dayThursday = document.createElement("div");
    dayThursday.classList.add("day");
    dayThursday.setAttribute("id", "Thursday");
    dayThursday.innerText = "Thursday";
    const howManyThursdayTasks = document.createElement("p");
    howManyThursdayTasks.classList.add("how-many-tasks-on-day");
    // howManyTasks.innerText = "You have " + user.tasks.day.count + " on " + day;
    howManyThursdayTasks.innerText = "You have 5 tasks on Thursday";
    const clickHereThursday = document.createElement("p");
    clickHereThursday.classList.add("click-here-message");
    clickHereThursday.innerText = "Click here to see Thursday's tasks.";
    displayWeeklyCalendar.appendChild(dayThursday);
    dayThursday.appendChild(howManyThursdayTasks);
    dayThursday.appendChild(clickHereThursday);

    const dayFriday = document.createElement("div");
    dayFriday.classList.add("day");
    dayFriday.setAttribute("id", "Friday");
    dayFriday.innerText = "Friday";
    const howManyFridayTasks = document.createElement("p");
    howManyFridayTasks.classList.add("how-many-tasks-on-day");
    // howManyTasks.innerText = "You have " + user.tasks.day.count + " on " + day;
    howManyFridayTasks.innerText = "You have 5 tasks on Friday";
    const clickHereFriday = document.createElement("p");
    clickHereFriday.classList.add("click-here-message");
    clickHereFriday.innerText = "Click here to see Friday's tasks.";
    displayWeeklyCalendar.appendChild(dayFriday);
    dayFriday.appendChild(howManyFridayTasks);
    dayFriday.appendChild(clickHereFriday);

    const dayOfTheWeek = document.createElement("div");
    dayOfTheWeek.classList.add("day");
    dayOfTheWeek.setAttribute("id", "Saturday");
    dayOfTheWeek.innerText = "Saturday";
    const howManyTasks = document.createElement("p");
    howManyTasks.classList.add("how-many-tasks-on-day");
    // howManyTasks.innerText = "You have " + user.tasks.day.count + " on " + day;
    howManyTasks.innerText = "You have 5 tasks on Saturday";
    const clickHereSaturday = document.createElement("p");
    clickHereSaturday.classList.add("click-here-message");
    clickHereSaturday.innerText = "Click here to see Saturday's tasks.";
    displayWeeklyCalendar.appendChild(dayOfTheWeek);
    dayOfTheWeek.appendChild(howManyTasks);
    dayOfTheWeek.appendChild(clickHereSaturday)