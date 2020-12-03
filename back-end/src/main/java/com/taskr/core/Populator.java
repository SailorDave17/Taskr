package com.taskr.core;

import com.taskr.core.Resources.Task;
import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import com.taskr.core.Storages.TaskStorage;
import com.taskr.core.Storages.TaskTemplateStorage;
import com.taskr.core.Storages.UserStorage;
import java.util.Date;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class Populator implements CommandLineRunner {

    UserStorage userStorage;
    TaskTemplateStorage taskTemplateStorage;
    TaskStorage taskStorage;

    public Populator(UserStorage userStorage, TaskTemplateStorage taskTemplateStorage, TaskStorage taskStorage) {
        this.userStorage = userStorage;
        this.taskTemplateStorage = taskTemplateStorage;
        this.taskStorage = taskStorage;
    }

    @Override
    public void run(String... args) throws Exception {
        User testUser = new User("sample user");
        userStorage.save(testUser);
        TaskTemplate testTemplate = new TaskTemplate("Final Project Demo");
        testTemplate.setMinutesExpectedToComplete(300);
        testTemplate.setActualWorkTime(300);
        taskTemplateStorage.save(testTemplate);
        TaskTemplate testTemplate1 = new TaskTemplate("Do the dishes");
        testTemplate1.setMinutesExpectedToComplete(20);
        testTemplate.addUserWhoCanDoThisTask(testUser);
         testUser.updateUser();
//        userStorage.updateAllUsers();
//        taskTemplateStorage.addAllUsersToAllTaskTemplates();
        TaskTemplate testTemplate2 = new TaskTemplate("Wash a load of laundry");
        testTemplate2.setMinutesExpectedToComplete(120);
        testTemplate2.setActualWorkTime(20);
        TaskTemplate testTemplate3 = new TaskTemplate("Take out the trash");
        testTemplate3.setMinutesExpectedToComplete(5);
        TaskTemplate testTemplate4 = new TaskTemplate("Mow the lawn");
        testTemplate4.setMinutesExpectedToComplete(45);
        taskTemplateStorage.save(testTemplate1);
        taskTemplateStorage.save(testTemplate2);
        taskTemplateStorage.save(testTemplate3);
        taskTemplateStorage.save(testTemplate4);
        User testUser1 = new User("Mom");
        User testUser2 = new User("Dad");
        User testUser3 = new User("Bro");
        User testUser4 = new User("Sis");
        testUser.setTotalAvailableTime(600);
        testUser1.setTotalAvailableTime(300);
        testUser2.setTotalAvailableTime(600);
        testUser3.setTotalAvailableTime(200);
        testUser4.setTotalAvailableTime(200);
        userStorage.save(testUser);
        userStorage.save(testUser1);
        userStorage.save(testUser2);
        userStorage.save(testUser3);
        userStorage.save(testUser4);
//        taskTemplateStorage.allocateAllTasks();
        Task testTask = new Task(testUser, testTemplate);
        Date dueDate = new Date(1607576400000L);
        testTask.setDueBy(dueDate);
        testTask.setDescription(testTask.getDueBy().toString());
        taskStorage.save(testTask);
    }
}
