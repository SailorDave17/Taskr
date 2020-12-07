import {
    allUsers
} from "./sampleAllUserJson.js"

const displaySingleUserView = function(user) {
    const mainElement = document.createElement("main");
    mainElement.classList.add("main-content");
    const userPageHeader = document.createElement("div");
    userPageHeader.classList.add("user-page-header");
    // clearChildren(userPageHeader);
    const userNamePageElement = document.createElement("h1");
    userNamePageElement.classList.add("username");
    userNamePageElement.innerText = `${user.name}'s Task List` //whatever day is being accessed by the user. default will be Sunday
    const userIcon = document.createElement("img");
    userIcon.classList.add("user-page-icon");
    userIcon.setAttribute("src", "/front-end/images/woman_1f469.png")
    mainElement.appendChild(userPageHeader);
    userPageHeader.appendChild(userNamePageElement);
    userPageHeader.appendChild(userIcon);

    //set up sticky notes of tasks
    const listOfTasks = document.createElement("div");
    listOfTasks.classList.add("user-task-list");
    mainElement.appendChild(listOfTasks);
    let numberOfTasksDone = 0;
    user.taskList.forEach(task => {
        const taskStickyNote = document.createElement("div")
        taskStickyNote.classList.add("chores-list");

        const checkBox = document.createElement("input");
        checkBox.setAttribute("type", "checkbox");
        checkBox.classList.add("chore-done");
        // checkBox.setAttribute("id", task.title)
        checkBox.addEventListener('click', (checkboxEvent) => {
            checkboxEvent.preventDefault();
            clearChildren(mainElement);
            const taskStatusJson = {
                "done":true
            }
            fetch("http://localhost:8080/api/user/1" ,{
                method: 'PATCH', 
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(taskStatusJson)
            })
            .then(response => response.json())
            .then(user => displaySingleUserView(user))
            .then(singleUserElement => mainElement.appendChild(singleUserElement))
            .catch(error => console.log(error));
        });
        if (task.done === true) {
            checkBox.innerHTML = `<input type="checkbox" checked class="chore-done" id="check-chore">`
            numberOfTasksDone = numberOfTasksDone++;
        }
        const choreName = document.createElement("label");
        choreName.classList.add("chore-name")
        choreName.innerText = task.title;
        //choreName.innerText = "Vacuum Family Room";
        checkBox.setAttribute("id", "check-chore");
        choreName.setAttribute("for", "check-chore");
        const taskInfoList = document.createElement("ul")
        const taskDueDate = document.createElement("li");
        taskDueDate.classList.add("task-due-date");
        taskDueDate.innerText = task.dueBy;
        //taskDueDate.innerText = "Sunday";
        const taskDuration = document.createElement("li");
        taskDuration.classList.add("task-duration");
        taskDuration.innerText = task.minutesExpectedToComplete + " minutes";
        //taskDuration.innerText = "30 minutes";
        listOfTasks.appendChild(taskStickyNote);
        taskStickyNote.appendChild(checkBox);
        taskStickyNote.appendChild(choreName);
        taskStickyNote.appendChild(taskInfoList);
        taskStickyNote.appendChild(taskDueDate);
        taskStickyNote.appendChild(taskDuration); //not sure if appending them all to the same thing is the right choice//
    });
    
    //calculating percent of tasks completed for progress bar
    user.userNumberTasksAssigned = 2
    const percentOfTasksDone = numberOfTasksDone*100 / user.userNumberTasksAssigned;
    console.log(percentOfTasksDone);
    console.log(user.userNumberTasksAssigned);

    //set up progress bar
    const displayProgressBar = document.createElement("progress");
    displayProgressBar.classList.add("user-progress-bar");
    displayProgressBar.setAttribute("value", percentOfTasksDone);
    //displayProgressBar.setAttribute("value", "70");
    displayProgressBar.setAttribute("max", "100");
    mainElement.appendChild(displayProgressBar);




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
    dayOfTheWeek.appendChild(clickHereSaturday);



    return mainElement;
}

const clearChildren = function (element) {
    while (element.firstChild) {
        element.removeChild(element.lastChild);
    }
}

export {
    displaySingleUserView
    // clearChildren
}