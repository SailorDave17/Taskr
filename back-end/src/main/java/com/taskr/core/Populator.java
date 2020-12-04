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
        Date dueDate = new Date(1607576400000L);
        Task testTask = new Task(testUser, testTemplate);
        testTask.setDueBy(dueDate);
        testTask.setDescription(testTask.getDueBy().toString());
        taskStorage.save(testTask);
        testUser.updateUser();
        userStorage.save(testUser);
        TaskTemplate newTasktemplate01 = new TaskTemplate("Clean Common Area");
        TaskTemplate newTasktemplate02 = new TaskTemplate("Clean Garage");
        TaskTemplate newTasktemplate03 = new TaskTemplate("Clean Bathrooms");
        TaskTemplate newTasktemplate04 = new TaskTemplate("Take Out Trash");
        TaskTemplate newTasktemplate05 = new TaskTemplate("Wash Dishes");
        TaskTemplate newTasktemplate06 = new TaskTemplate("Wash/Dry Laundry");
        TaskTemplate newTasktemplate07 = new TaskTemplate("Fold/Put Away Laundry");
        TaskTemplate newTasktemplate08 = new TaskTemplate("Rake Leaves");
        TaskTemplate newTasktemplate09 = new TaskTemplate("Mow Lawn");
        TaskTemplate newTasktemplate10 = new TaskTemplate("Clean Bedroom");
        TaskTemplate newTasktemplate11 = new TaskTemplate("Deep Clean Kitchen");
        TaskTemplate newTasktemplate12 = new TaskTemplate("Tidy Kitchen");
        TaskTemplate newTasktemplate13 = new TaskTemplate("Vacuum Living Room");
        TaskTemplate newTasktemplate14 = new TaskTemplate("Mop/Sweep Kitchen");
        TaskTemplate newTasktemplate15 = new TaskTemplate("Change Litter Box");
        TaskTemplate newTasktemplate16 = new TaskTemplate("Walk Dog");
        TaskTemplate newTasktemplate17 = new TaskTemplate("Clean Up Yard");
        TaskTemplate newTasktemplate18 = new TaskTemplate("Get Mail");
        TaskTemplate newTasktemplate19 = new TaskTemplate("Dust Living Room");
        TaskTemplate newTasktemplate20 = new TaskTemplate("Dust Family Room");
        TaskTemplate newTasktemplate21 = new TaskTemplate("Vacuum Family Room");
        TaskTemplate newTasktemplate22 = new TaskTemplate("Dust Ceiling Fans");

        taskTemplateStorage.save(newTasktemplate01);
        taskTemplateStorage.save(newTasktemplate02);
        taskTemplateStorage.save(newTasktemplate03);
        taskTemplateStorage.save(newTasktemplate04);
        taskTemplateStorage.save(newTasktemplate05);
        taskTemplateStorage.save(newTasktemplate06);
        taskTemplateStorage.save(newTasktemplate07);
        taskTemplateStorage.save(newTasktemplate08);
        taskTemplateStorage.save(newTasktemplate09);
        taskTemplateStorage.save(newTasktemplate10);
        taskTemplateStorage.save(newTasktemplate11);
        taskTemplateStorage.save(newTasktemplate12);
        taskTemplateStorage.save(newTasktemplate13);
        taskTemplateStorage.save(newTasktemplate14);
        taskTemplateStorage.save(newTasktemplate15);
        taskTemplateStorage.save(newTasktemplate16);
        taskTemplateStorage.save(newTasktemplate17);
        taskTemplateStorage.save(newTasktemplate18);
        taskTemplateStorage.save(newTasktemplate19);
        taskTemplateStorage.save(newTasktemplate20);
        taskTemplateStorage.save(newTasktemplate21);
        taskTemplateStorage.save(newTasktemplate22);




        Task newTask1 = new Task(testUser1, newTasktemplate01);
        Task newTask2 = new Task(testUser1, testTemplate2);
        Task newTask3 = new Task(testUser2, newTasktemplate22);
        Task newTask4 = new Task(testUser3, testTemplate3);
        Task newTask5 = new Task(testUser4, testTemplate1);
        Task newTask6 = new Task(testUser1, testTemplate4);
        Task newTask7 = new Task(testUser2, testTemplate1);
        Task newTask8 = new Task(testUser3, newTasktemplate20);
        Task newTask9 = new Task(testUser3, testTemplate1);
        Task newTask10 = new Task(testUser4, testTemplate1);
        Task newTask11 = new Task(testUser1, testTemplate1);
        Task newTask12 = new Task(testUser2, testTemplate1);
        Task newTask13 = new Task(testUser3, testTemplate1);
        Task newTask14 = new Task(testUser4, testTemplate1);
        Task newTask15 = new Task(testUser3, testTemplate1);
        Task aNewTask0 = new Task(testUser1, newTasktemplate01);
        Task aNewTask1 = new Task(testUser1, newTasktemplate02);
        Task aNewTask2 = new Task(testUser1, newTasktemplate03);
        Task aNewTask3 = new Task(testUser1, newTasktemplate04);
        Task aNewTask4 = new Task(testUser1, newTasktemplate05);
        Task aNewTask5 = new Task(testUser1, newTasktemplate06);
        Task aNewTask6 = new Task(testUser1, newTasktemplate07);
        Task aNewTask7 = new Task(testUser1, newTasktemplate08);
        Task aNewTask8 = new Task(testUser1, newTasktemplate09);
        Task aNewTask9 = new Task(testUser1, newTasktemplate10);
        Task aNewTask10 = new Task(testUser2, newTasktemplate01);
        Task aNewTask11 = new Task(testUser2, newTasktemplate02);
        Task aNewTask12 = new Task(testUser2, newTasktemplate03);
        Task aNewTask13 = new Task(testUser2, newTasktemplate04);
        Task aNewTask14 = new Task(testUser2, newTasktemplate05);
        Task aNewTask15 = new Task(testUser2, newTasktemplate06);
        Task aNewTask16 = new Task(testUser2, newTasktemplate07);
        Task aNewTask17 = new Task(testUser2, newTasktemplate08);
        Task aNewTask18 = new Task(testUser2, newTasktemplate09);
        Task aNewTask19 = new Task(testUser2, newTasktemplate10);
        Task aNewTask20 = new Task(testUser3 ,newTasktemplate10);
        Task aNewTask21 = new Task(testUser3 ,newTasktemplate11);
        Task aNewTask22 = new Task(testUser3 ,newTasktemplate12);
        Task aNewTask23 = new Task(testUser3 ,newTasktemplate13);
        Task aNewTask24 = new Task(testUser3 ,newTasktemplate14);
        Task aNewTask25 = new Task(testUser3 ,newTasktemplate15);
        Task aNewTask26 = new Task(testUser3 ,newTasktemplate16);
        Task aNewTask27 = new Task(testUser3 ,newTasktemplate17);
        Task aNewTask28 = new Task(testUser3 ,newTasktemplate18);
        Task aNewTask29 = new Task(testUser3 ,newTasktemplate19);
        Task aNewTask30 = new Task(testUser4, newTasktemplate10);
        Task aNewTask31 = new Task(testUser4, newTasktemplate11);
        Task aNewTask32 = new Task(testUser4, newTasktemplate12);
        Task aNewTask33 = new Task(testUser4, newTasktemplate13);
        Task aNewTask34 = new Task(testUser4, newTasktemplate14);
        Task aNewTask35 = new Task(testUser4, newTasktemplate15);
        Task aNewTask36 = new Task(testUser4, newTasktemplate16);
        Task aNewTask37 = new Task(testUser4, newTasktemplate17);
        Task aNewTask38 = new Task(testUser4, newTasktemplate18);
        Task aNewTask39 = new Task(testUser4, newTasktemplate19);
        Task aNewTask40 = new Task(testUser, newTasktemplate21);

        taskStorage.save(aNewTask0);
        taskStorage.save(aNewTask1);
        taskStorage.save(aNewTask2);
        taskStorage.save(aNewTask3);
        taskStorage.save(aNewTask4);
        taskStorage.save(aNewTask5);
        taskStorage.save(aNewTask6);
        taskStorage.save(aNewTask7);
        taskStorage.save(aNewTask8);
        taskStorage.save(aNewTask9);
        taskStorage.save(aNewTask10);
        taskStorage.save(aNewTask11);
        taskStorage.save(aNewTask12);
        taskStorage.save(aNewTask13);
        taskStorage.save(aNewTask14);
        taskStorage.save(aNewTask15);
        taskStorage.save(aNewTask16);
        taskStorage.save(aNewTask17);
        taskStorage.save(aNewTask18);
        taskStorage.save(aNewTask19);
        taskStorage.save(aNewTask20);
        taskStorage.save(aNewTask21);
        taskStorage.save(aNewTask22);
        taskStorage.save(aNewTask23);
        taskStorage.save(aNewTask24);
        taskStorage.save(aNewTask25);
        taskStorage.save(aNewTask26);
        taskStorage.save(aNewTask27);
        taskStorage.save(aNewTask28);
        taskStorage.save(aNewTask29);
        taskStorage.save(aNewTask30);
        taskStorage.save(aNewTask31);
        taskStorage.save(aNewTask32);
        taskStorage.save(aNewTask33);
        taskStorage.save(aNewTask34);
        taskStorage.save(aNewTask35);
        taskStorage.save(aNewTask36);
        taskStorage.save(aNewTask37);
        taskStorage.save(aNewTask38);
        taskStorage.save(aNewTask39);
        taskStorage.save(aNewTask40);

        userStorage.save(testUser);
        userStorage.save(testUser1);
        userStorage.save(testUser2);
        userStorage.save(testUser3);
        userStorage.save(testUser4);


    }


}
