package com.taskr.core;

import com.taskr.core.Resources.Task;
import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import com.taskr.core.Storages.TaskStorage;
import com.taskr.core.Storages.TaskTemplateStorage;
import com.taskr.core.Storages.UserStorage;
import java.util.Date;
import java.util.HashSet;

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
//    this is just to make sure I can commit

    @Override
    public void run(String... args) throws Exception {
        User testUser = new User("Mom");
        userStorage.save(testUser);
        TaskTemplate testTemplate = new TaskTemplate("Final Project Demo", "", 300);
        taskTemplateStorage.save(testTemplate);
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
//        Date dueDate = new Date(1607576400000L);
//        Task testTask = new Task(testUser, testTemplate);
//        testTask.setDueBy(dueDate);
//        testTask.setDescription("Test Task");
//        taskStorage.save(testTask);
//        userStorage.updateUser(testUser);
//        userStorage.save(testUser);
        TaskTemplate newTasktemplate01 = new TaskTemplate("Clean Common Area", "Clean all common areas", 30, 30);
        TaskTemplate newTasktemplate02 = new TaskTemplate("Clean Garage", "Sweep and organize the Garage", 45, 45);
        TaskTemplate newTasktemplate03 = new TaskTemplate("Clean Bathrooms", "Wipe down sinks, scrub toilets, sweep and mop floors, and empty bathroom trash", 30, 30);
        TaskTemplate newTasktemplate04 = new TaskTemplate("Take Out Trash", "Take all trash to rolling bin outside and take the rolling bin to the road if today is a trash day", 15);
        TaskTemplate newTasktemplate05 = new TaskTemplate("Wash Dishes", "Wash and dry all dishes in the sink and empty/load the dishwasher", 30);
        TaskTemplate newTasktemplate06 = new TaskTemplate("Wash/Dry Laundry", "", 30, 200);
        TaskTemplate newTasktemplate07 = new TaskTemplate("Fold/Put Away Laundry", "", 30);
        TaskTemplate newTasktemplate08 = new TaskTemplate("Rake Leaves", "Rake and bag the leaves from the front, back, and sides of the house", 45);
        TaskTemplate newTasktemplate09 = new TaskTemplate("Mow Lawn", "Pick up rocks and sticks in the yards and mow the front and back lawn", 45);
        TaskTemplate newTasktemplate10 = new TaskTemplate("Clean Bedroom", "Clean your room", 30);
        TaskTemplate newTasktemplate11 = new TaskTemplate("Deep Clean Kitchen", "Clear off and wipe down all counter tops, wipe cabinet fronts, wipe behind sink, wipe trim boards under cabinets, sweep, and mop kitchen", 90);
        TaskTemplate newTasktemplate12 = new TaskTemplate("Tidy Kitchen", "Move dishes to sink, wipe down counter tops and table, and sweep floors", 30);
        TaskTemplate newTasktemplate13 = new TaskTemplate("Vacuum Living Room", "Vacuum floors, crevases, and under furniture, and remove couch cushions to vacuum under cushions", 30);
        TaskTemplate newTasktemplate14 = new TaskTemplate("Mop/Sweep Kitchen", "Sweep and hot mop the kitchen floors", 30);
        TaskTemplate newTasktemplate15 = new TaskTemplate("Change Litter Box", "Scoop the litter box and replace the litter if today is Friday", 15);
        TaskTemplate newTasktemplate16 = new TaskTemplate("Walk Dog", "Take the dogs for a walk around the block", 20);
        TaskTemplate newTasktemplate17 = new TaskTemplate("Clean Up Yard", "Pick up sticks and rocks in the front and back yard and pick up any trash that has blown in", 20);
        TaskTemplate newTasktemplate18 = new TaskTemplate("Get Mail", "Get the mail from the mailbox", 5);
        TaskTemplate newTasktemplate19 = new TaskTemplate("Dust Living Room", "Dust picture frames, end tables, coffee table, and door sills in the living room", 20);
        TaskTemplate newTasktemplate20 = new TaskTemplate("Dust Family Room", "Dust bookshelves, mantel over fireplace, stereo, and door sills in family room", 20);
        TaskTemplate newTasktemplate21 = new TaskTemplate("Vacuum Family Room", "Vacuum floors, crevases, and under furniture in the family room", 20);
        TaskTemplate newTasktemplate22 = new TaskTemplate("Dust Ceiling Fans", "Wipe blades of ceiling fans down and ensure dust is blown out of fan motor housing", 30);

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


        userStorage.save(testUser);
        userStorage.save(testUser1);
        userStorage.save(testUser2);
        userStorage.save(testUser3);
        userStorage.save(testUser4);

    }


}
